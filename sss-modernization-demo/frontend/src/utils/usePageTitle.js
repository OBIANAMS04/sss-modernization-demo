import { useEffect } from 'react';

const APP_TITLE = 'SSS Modernization Demo';

/** Gives each screen its own document title ("Case Management · SSS Modernization Demo") for WCAG 2.4.2. */
export default function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
  }, [title]);
}
