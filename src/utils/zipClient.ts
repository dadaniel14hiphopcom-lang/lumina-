export interface BrowserZipEntry {
  name: string;
  content: Uint8Array | string;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function createBrowserZipBlob(entries: BrowserZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name.replace(/^\/+/, ''));
    const dataBytes =
      typeof entry.content === 'string'
        ? encoder.encode(entry.content)
        : entry.content;
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x5421, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x5421, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);

    centralParts.push(centralHeader, nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralDirBytes = concatUint8Arrays(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralDirBytes.length, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);

  const combined = concatUint8Arrays([...localParts, centralDirBytes, eocd]);
  const copy = new Uint8Array(combined.length);
  copy.set(combined);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

export interface WordPressKitConfig {
  siteUrl: string;
  siteTitle: string;
  dbEngine: 'mariadb-11' | 'mysql-8';
  dbName: string;
  tablePrefix: string;
  phpVersion: '8.3' | '8.2';
  permalinks: string;
  sslEnabled: boolean;
  redisCache: boolean;
  disableXmlRpc: boolean;
  siteVersion: string;
}

export function buildWordPressKitEntries(wp: WordPressKitConfig): {
  domain: string;
  entries: BrowserZipEntry[];
} {
  const domain =
    (wp.siteUrl || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '')
      .slice(0, 100) || 'meudominio.com.br';
  const dbName =
    (wp.dbName || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 48) || 'lumina_wp';
  const prefix =
    (wp.tablePrefix || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 48) || 'wp_lum_';
  const wpImage =
    wp.phpVersion === '8.2'
      ? 'wordpress:6.7-php8.2-fpm-alpine'
      : 'wordpress:6.7-php8.3-fpm-alpine';
  const dbImage = wp.dbEngine === 'mysql-8' ? 'mysql:8.4' : 'mariadb:11.4';

  const dockerCompose = `services:
  db:
    image: ${dbImage}
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${dbName}
      MYSQL_USER: lumina_wp_user
      MYSQL_PASSWORD: \${WP_DB_PASSWORD:?Defina WP_DB_PASSWORD no .env}
      MYSQL_ROOT_PASSWORD: \${WP_DB_ROOT_PASSWORD:?Defina WP_DB_ROOT_PASSWORD no .env}
    volumes:
      - db_data:/var/lib/mysql

  wordpress:
    image: ${wpImage}
    restart: unless-stopped
    depends_on:
      - db
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: ${dbName}
      WORDPRESS_DB_USER: lumina_wp_user
      WORDPRESS_DB_PASSWORD: \${WP_DB_PASSWORD}
      WORDPRESS_TABLE_PREFIX: ${prefix}
    volumes:
      - wp_content:/var/www/html/wp-content
      - ./lumina-bridge.php:/var/www/html/wp-content/plugins/lumina-bridge/lumina-bridge.php:ro
${
  wp.redisCache
    ? `
  redis:
    image: redis:7-alpine
    restart: unless-stopped
`
    : ''
}
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on:
      - wordpress
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - wp_content:/var/www/html/wp-content:ro

volumes:
  db_data:
  wp_content:
`;

  const wpConfig = `<?php
define('DB_NAME', getenv('WORDPRESS_DB_NAME') ?: '${dbName}');
define('DB_USER', getenv('WORDPRESS_DB_USER') ?: 'lumina_wp_user');
define('DB_PASSWORD', getenv('WORDPRESS_DB_PASSWORD'));
define('DB_HOST', getenv('WORDPRESS_DB_HOST') ?: 'db:3306');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

$table_prefix = '${prefix}';

define('WP_HOME', '${wp.sslEnabled ? 'https' : 'http'}://${domain}');
define('WP_SITEURL', '${wp.sslEnabled ? 'https' : 'http'}://${domain}');
define('WP_CACHE', ${wp.redisCache ? 'true' : 'false'});
define('DISALLOW_FILE_EDIT', true);
define('FORCE_SSL_ADMIN', ${wp.sslEnabled ? 'true' : 'false'});

if (!defined('ABSPATH')) {
  define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';
`;

  const nginxConf = `server {
    listen 80;
    server_name ${domain};

    client_max_body_size 64M;
${
  wp.disableXmlRpc
    ? `
    location = /xmlrpc.php {
        deny all;
        return 403;
    }
`
    : ''
}
    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \\.php$ {
        include fastcgi_params;
        fastcgi_pass wordpress:9000;
        fastcgi_param SCRIPT_FILENAME /var/www/html$fastcgi_script_name;
    }
}
`;

  const luminaPlugin = `<?php
/**
 * Plugin Name: Lumina Self-Hosted Bridge
 * Description: Integra publicações, usuários e feed da rede social Lumina ao seu WordPress auto-hospedado.
 * Version: ${wp.siteVersion}
 * Author: ${wp.siteTitle}
 */

if (!defined('ABSPATH')) exit;

add_shortcode('lumina_feed', function ($atts) {
    $atts = shortcode_atts(['limit' => '12'], $atts);
    return '<div id="lumina-wp-embed" data-limit="' . esc_attr($atts['limit']) . '">Lumina Feed conectado.</div>';
});

add_action('rest_api_init', function () {
    register_rest_route('lumina/v1', '/health', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => function () {
            return ['status' => 'ok', 'self_hosted' => true, 'version' => '${wp.siteVersion}'];
        },
    ]);
});
`;

  const readme = `# WordPress Auto-Hospedado — ${wp.siteTitle}

Este pacote dá controle total da infraestrutura ao administrador:

1. Copie \`.env.example\` para \`.env\` e defina \`WP_DB_PASSWORD\` e \`WP_DB_ROOT_PASSWORD\`.
2. Execute: \`docker compose up -d\`
3. Acesse \`${wp.sslEnabled ? 'https' : 'http'}://${domain}/wp-admin\` para concluir a instalação.
4. Ative o plugin **Lumina Self-Hosted Bridge** em Plugins e configure os links permanentes para \`${wp.permalinks}\`.
`;

  return {
    domain,
    entries: [
      { name: 'docker-compose.yml', content: dockerCompose },
      { name: 'wp-config.php', content: wpConfig },
      { name: 'nginx.conf', content: nginxConf },
      { name: 'lumina-bridge.php', content: luminaPlugin },
      {
        name: '.env.example',
        content:
          'WP_DB_PASSWORD=troque_esta_senha\nWP_DB_ROOT_PASSWORD=troque_esta_senha_root\n',
      },
      { name: 'README-AUTO-HOSPEDAGEM.md', content: readme },
    ],
  };
}
