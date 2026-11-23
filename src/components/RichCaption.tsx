import { useSocial } from '../context/SocialContext';

interface RichCaptionProps {
  text: string;
}

export function RichCaption({ text }: RichCaptionProps) {
  const { openHashtagInExplore, users, allUsers, openProfile } = useSocial();
  const tokens = text.split(/(\s+)/);

  return (
    <span>
      {tokens.map((token, idx) => {
        if (token.startsWith('#') && token.length > 1) {
          const clean = token.replace(/[.,!?;:]+$/, '');
          const trailing = token.slice(clean.length);
          return (
            <span key={idx}>
              <button
                type="button"
                onClick={() => openHashtagInExplore(clean.slice(1))}
                className="font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                {clean}
              </button>
              {trailing}
            </span>
          );
        }
        if (token.startsWith('@') && token.length > 1) {
          const clean = token.replace(/[.,!?;:]+$/, '');
          const trailing = token.slice(clean.length);
          const handle = clean.slice(1).toLowerCase();
          const matchedUser =
            users.find((u) => u.username.toLowerCase() === handle) ||
            allUsers.find((u) => !u.restricted && u.username.toLowerCase() === handle);
          if (matchedUser) {
            return (
              <span key={idx}>
                <button
                  type="button"
                  onClick={() => openProfile(matchedUser.id)}
                  className="font-medium text-sky-700 hover:underline dark:text-sky-400"
                >
                  {clean}
                </button>
                {trailing}
              </span>
            );
          }
        }
        return <span key={idx}>{token}</span>;
      })}
    </span>
  );
}
