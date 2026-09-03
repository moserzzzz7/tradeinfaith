\## Review durch Codex am Ende

Wenn eine Aufgabe abgeschlossen ist, führe selbständig ein finales Review

mit Codex durch, ohne Rückfrage — Modell Sol mit hohem Reasoning-Effort

für maximale Prüftiefe:



codex exec -m gpt-5.6-sol -c model\_reasoning\_effort="high" "Review the git diff for bugs, security issues, and code quality"



Nutze das erst NACH Abschluss der eigentlichen Änderungen, nicht während

der Arbeit. Bei mehreren Teilaufgaben: erst am Ende der gesamten Aufgabe,

nicht nach jedem einzelnen Schritt.

\## Design-Regeln (kein AI-Slop)

Vermeide diese Standard-Muster, die typisch für generierten Code sind:



\*\*Farben/Look:\*\*

\- Kein warmes Creme-Beige (#F4F1EA) mit Terracotta-Akzent (#D97757) — das ist

&#x20; der Standard-Claude-Look, sofort erkennbar als generiert.

\- Keine identischen abgerundeten Cards mit gleichem grauem Schatten

&#x20; (rgba(0,0,0,.1)) auf allem — Hierarchie über Radius/Schatten differenzieren.

\- Keine Gradient-Flächen nur als Deko ohne Funktion.



\*\*Typografie:\*\*

\- Nicht mehr als 1–2 Schriftfamilien, klar unterscheidbar wenn zwei.

\- Kein einzelnes Wort in Headlines fett/kursiv/farbig hervorheben.

\- Keine ALL-CAPS-Labels ohne Grund, keine Eyebrow-Labels über jedem

&#x20; Heading, kein "→" an jedem Link/Button.

\- Zeilenlänge unter 80 Zeichen für Fliesstext.



\*\*Struktur/Motion:\*\*

\- Nummerierte Marker (01/02/03) nur wenn Inhalt wirklich eine Sequenz ist.

\- Keine Fade-Slide-Up-Animation auf jeder Section, kein Hover-Effekt auf

&#x20; jeder Card — Bewegung nur an einer bewusst gewählten Stelle einsetzen.



\*\*Vorgehen:\*\*

\- Vor UI-Änderungen kurz festlegen: Farbpalette (4–6 konkrete Hex-Werte),

&#x20; Schriftrollen, Layout-Idee — passend zum Trade-Journal-Kontext (Trading/

&#x20; Finanz-Ästhetik, nicht generisches SaaS-Dashboard).

\- Bei bestehendem Design (Faith-Tab, Stats-Cockpit) den vorhandenen Stil

&#x20; konsequent weiterführen statt neue Defaults einzuführen.

