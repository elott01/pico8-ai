// What the Gemini panel shows before its first card: what to do, then what each card will
// hold. Shared by TurnPanel and TalkPanel; the words are each cart's, in src/lib/carts.ts.
//
// It stays up through the first "Gemini is thinking…", which can take seconds and is when
// the player is looking here. Only the action goes, since by then they have done it.

import type { PanelIntro } from '../lib/carts.ts';
import styles from './TurnPanel.module.scss';

export default function EmptyPanel({ intro, thinking }: { intro: PanelIntro; thinking: boolean }) {
  return (
    <div className={styles.intro}>
      {!thinking && <p className={styles.action}>{intro.action}</p>}
      <p>{intro.lead}</p>
      {intro.shows.length > 0 && (
        <ul className={styles.shows}>
          {intro.shows.map(({ label, text }) => (
            <li key={text}>
              {label && <span className={styles.label}>{label}:</span>}
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
