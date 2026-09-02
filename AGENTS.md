\# AGENTS.md — TradeInFaith



\## Zusammenarbeit mit Claude Code

Wenn ein Feature oder eine Änderung fertiggestellt ist, rufe Claude Code

automatisch zur Prüfung auf:



claude -p "Prüfe <Datei/Änderung> auf Sicherheitslücken und Verbesserungspotenzial. Liste konkrete Findings mit Schweregrad (kritisch/mittel/niedrig)."



\## Entscheidungshoheit

Claude Codes Rückmeldung ist ein Input, keine Vorgabe. Codex bewertet die

Findings selbst und entscheidet eigenständig, welche übernommen werden.

Bei Widerspruch zwischen Codex und Claude Code gilt Codex' Einschätzung.



\## Wann triggern

\- Nach Abschluss eines Features oder einer größeren Änderung

\- Vor jedem Commit an sicherheitsrelevanten Stellen (Auth, Daten-Handling, API-Calls)

\- Nicht bei jeder kleinen Zeile — nur bei abgeschlossenen, sinnvollen Einheiten

