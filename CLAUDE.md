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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
