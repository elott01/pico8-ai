// Ethan's bio and links, for the About section. Filled in by hand. A field left empty is left
// out of the page, so the page can ship before they're all filled.

type Site = {
  repo: string;
  /** Two or three sentences, shown after "I’m Ethan." */
  bio: string;
  links: {
    /** Profile URL, e.g. https://github.com/… */
    github: string;
    /** Profile URL, e.g. https://www.linkedin.com/in/… */
    linkedin: string;
    /** The address alone; the page makes it a mailto: link. */
    email: string;
    /** Any one more link, such as a personal site. Both fields, or it's left out. */
    other: { label: string; url: string };
  };
};

export const SITE: Site = {
  repo: 'https://github.com/elott01/pico8-ai',
  bio:
    'I’ve been building software at one of the largest US banks since 2024. I made this on ' +
    'my own time, for fun.',
  links: {
    github: 'https://github.com/elott01',
    linkedin: 'https://www.linkedin.com/in/ethan-lott/',
    email: '',
    other: { label: '', url: '' },
  },
};
