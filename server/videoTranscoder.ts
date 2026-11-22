import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
}

interface FfprobeFormat {
  format_name?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export interface NormalizedVideoFileResult {
  filePath: string;
  contentType: string;
  ext: string;
  transcoded: boolean;
  cleanupTempFiles: () => void;
}

async function probeVideoFile(filePath: string): Promise<FfprobeOutput | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        filePath,
      ],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }
    );
    return JSON.parse(stdout || '{}') as FfprobeOutput;
  } catch {
    return null;
  }
}

function isWebReadyMp4(probe: FfprobeOutput | null): boolean {
  if (!probe?.streams?.length) return false;
  const formatName = (probe.format?.format_name || '').toLowerCase();
  const isMp4Container = formatName.split(',').includes('mp4');
  if (!isMp4Container) return false;

  const video = probe.streams.find((s) => s.codec_type === 'video');
  if (!video || video.codec_name !== 'h264') return false;
  if (video.pix_fmt && video.pix_fmt !== 'yuv420p') return false;

  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  if (audio && audio.codec_name !== 'aac' && audio.codec_name !== 'mp3') {
    return false;
  }

  return true;
}

function isWebReadyH264Stream(probe: FfprobeOutput | null): boolean {
  if (!probe?.streams?.length) return false;
  const video = probe.streams.find((s) => s.codec_type === 'video');
  if (!video || video.codec_name !== 'h264') return false;
  if (video.pix_fmt && video.pix_fmt !== 'yuv420p') return false;

  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  if (audio && audio.codec_name !== 'aac' && audio.codec_name !== 'mp3') {
    return false;
  }
  return true;
}

/**
 * Normalizes any uploaded Reel video (HEVC/H.265, .mov, .3gp, .mkv, .webm, 10-bit, etc.)
 * into universal H.264 (yuv420p) + AAC MP4 with +faststart atom placement so it plays
 * across desktop Chrome/Firefox/Edge and iOS/Android Safari without codec errors.
 */
export async function normalizeVideoFileForWeb(params: {
  inputPath: string;
  originalExt: string;
  originalContentType: string;
  workDir: string;
}): Promise<NormalizedVideoFileResult> {
  const safeInput = path.resolve(params.inputPath);
  const safeWorkDir = path.resolve(params.workDir);
  if (!safeInput.startsWith(safeWorkDir + path.sep)) {
    throw new Error('Caminho de vídeo inválido para processamento.');
  }

  const probe = await probeVideoFile(safeInput);
  if (!probe) {
    // Unrecognized/synthetic probe (e.g. tiny stub): keep original unchanged
    return {
      filePath: safeInput,
      contentType: params.originalContentType,
      ext: params.originalExt,
      transcoded: false,
      cleanupTempFiles: () => {},
    };
  }

  const outName = `norm_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.mp4`;
  const safeOutput = path.resolve(safeWorkDir, outName);
  if (!safeOutput.startsWith(safeWorkDir + path.sep)) {
    throw new Error('Caminho de saída inválido para processamento.');
  }

  const cleanupOut = () => {
    try {
      if (fs.existsSync(safeOutput)) fs.unlinkSync(safeOutput);
    } catch {
      // Ignore cleanup errors
    }
  };

  // Already H.264 + yuv420p + AAC inside MP4: remux +faststart quickly without re-encoding
  if (isWebReadyMp4(probe) || isWebReadyH264Stream(probe)) {
    try {
      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', safeInput, '-c', 'copy', '-movflags', '+faststart', safeOutput],
        { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
      );
      if (fs.existsSync(safeOutput) && fs.statSync(safeOutput).size > 0) {
        return {
          filePath: safeOutput,
          contentType: 'video/mp4',
          ext: 'mp4',
          transcoded: true,
          cleanupTempFiles: cleanupOut,
        };
      }
    } catch {
      cleanupOut();
      // Fall through to full transcode if container remux failed
    }
  }

  // Full transcode (HEVC/H.265, 10-bit, WebM, MOV, 3GP, MKV, AC3, etc.) -> H.264 + AAC MP4
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        safeInput,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        safeOutput,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    );
    if (fs.existsSync(safeOutput) && fs.statSync(safeOutput).size > 0) {
      return {
        filePath: safeOutput,
        contentType: 'video/mp4',
        ext: 'mp4',
        transcoded: true,
        cleanupTempFiles: cleanupOut,
      };
    }
  } catch {
    cleanupOut();
  }

  // Graceful fallback to original file if ffmpeg could not transcode
  return {
    filePath: safeInput,
    contentType: params.originalContentType,
    ext: params.originalExt,
    transcoded: false,
    cleanupTempFiles: () => {},
  };
}
