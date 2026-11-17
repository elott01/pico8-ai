// The About section, under the arcade: what the project is, how a move travels from the cart
// to Gemini and back, why the AI panel exists, what the model can't do, and who made it.
// A section of this page rather than a page of its own, because leaving the page would
// unload the running cart.
//
// It comes after the cart in the DOM, and the cart's iframe swallows Tab, so the keyboard
// way here is the header's About link: following it moves the browser's Tab starting point
// to this section. Ethan's bio and links come from lib/site.ts.

import type { ReactNode } from 'react';
import { SITE } from '../lib/site.ts';
import styles from './About.module.scss';

// What carries a move, cart to model. Each step talks both ways.
const CHAIN = [
  ['PICO-8 cart', 'Lua: the rules, win checks and a backup minimax player'],
  ['GPIO', '128 bytes the cart shares with the page'],
  ['Web page', 'React, reading those bytes every 100 ms'],
  ['Server', '/api/move and /api/talk on Vercel, holding the key'],
  ['Gemini', 'picks the move or writes the line, and says why'],
] as const;

type Link = { href: string; text: string; icon: ReactNode; external: boolean };

export default function About() {
  const { github, linkedin, email, other } = SITE.links;
  // An empty field leaves '' in place of its link, filtered out below
  const candidates: (Link | '')[] = [
    { href: SITE.repo, text: 'Source', icon: <CodeIcon />, external: true },
    github && { href: github, text: 'GitHub', icon: <GitHubMark />, external: true },
    linkedin && { href: linkedin, text: 'LinkedIn', icon: <LinkedInMark />, external: true },
    // The address itself, which people tend to want to copy
    email && { href: `mailto:${email}`, text: email, icon: <EnvelopeIcon />, external: false },
    other.label && other.url && { href: other.url, text: other.label, icon: <LinkIcon />, external: true },
  ];
  const links = candidates.filter((link): link is Link => link !== '');

  return (
    <section id="about" className={styles.about} aria-labelledby="about-heading">
      <div className={styles.top}>
        <div className={styles.text}>
          <div className={styles.block}>
            <h2 id="about-heading" className={styles.heading}>
              About this project
            </h2>
            <p className={styles.intro}>
              Ethan’s Pico-AIght Arcade is a set of PICO-8 games with Google Gemini on the other
              side. In Tic-Tac-Toe and Connect Four it’s your opponent. In Gem-in-Eye it runs the
              shop: it sizes up your run, sets the price and tells you what it thinks.
            </p>
          </div>
          <div className={styles.block}>
            <h3 className={styles.subheading}>How it works</h3>
            <p className={styles.body}>
              A PICO-8 cart can’t make network calls. So on the AI’s turn, the cart writes the
              board into 128 bytes of memory it shares with the web page. The page sends it to a
              small server function, which asks Gemini and hands the answer back for the cart to
              play. The API key never leaves the server.
            </p>
          </div>
        </div>

        <ol className={styles.chain} aria-label="How a move travels, cart to Gemini and back">
          {CHAIN.map(([name, note]) => (
            <li key={name}>
              <span className={styles.stepName}>{name}</span>
              <span className={styles.stepNote}>{note}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.columns}>
        <div className={styles.block}>
          <h3 className={styles.subheading}>Why the AI panel is there</h3>
          <p className={styles.body}>
            It’s the evidence that a language model chose each move. For every turn it shows what
            the model wrote: the lines it scored in Tic-Tac-Toe, the rule it applied in Connect
            Four, what Gem-in-Eye noticed about your run. It never shows numbers the code worked
            out on the model’s behalf.
          </p>
          <p className={styles.body}>
            When Gemini is slow, rate-limited or answers with an illegal move, the cart’s own
            minimax plays instead, and the panel labels that turn.
          </p>
        </div>
        <div className={styles.block}>
          <h3 className={styles.subheading}>What it can’t do</h3>
          <p className={styles.body}>
            Gemini doesn’t see forks, moves that set up two winning threats at once. Given a Connect
            Four position where one column makes a fork, it played the centre column instead, 9
            times out of 9, with every prompt I tried. In Tic-Tac-Toe, taking two opposite corners
            can still beat it.
          </p>
          <p className={styles.body}>
            Every prompt variant missed it the same way, so the project treats it as a limit of the
            model and measures it.
          </p>
        </div>
      </div>

      <div className={styles.who}>
        <div className={styles.block}>
          <h3 className={styles.subheading}>Who made it</h3>
          <p className={styles.body}>I’m Ethan.{SITE.bio && ` ${SITE.bio}`}</p>
        </div>
        <ul className={styles.links}>
          {links.map(({ href, text, icon, external }) => (
            <li key={href}>
              <a
                className={styles.chip}
                href={href}
                // WebKit leaves links out of the tab order by default; see CartCard
                tabIndex={0}
                // Off the site, so a new tab: leaving this one would lose the game in progress
                {...(external ? { target: '_blank', rel: 'noopener' } : {})}
              >
                {icon}
                {text}
                {external && <span className={styles.srOnly}>(opens in a new tab)</span>}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Stroke({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function CodeIcon() {
  return (
    <Stroke>
      <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" />
    </Stroke>
  );
}

function EnvelopeIcon() {
  return (
    <Stroke>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m2.5 4.5 5.5 4.5 5.5-4.5" />
    </Stroke>
  );
}

function LinkIcon() {
  return (
    <Stroke>
      <path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-.75.75" />
      <path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l.75-.75" />
    </Stroke>
  );
}

// GitHub's and LinkedIn's own marks, unmodified and in one colour, as both companies allow
// for linking to a profile.
function GitHubMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
