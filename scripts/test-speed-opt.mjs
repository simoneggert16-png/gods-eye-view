const key = process.env.ABACUS_API_KEY || "s2_c73eaf96c44d4b31a96e62d6a2759591";

async function testOpt() {
  const t0 = Date.now();
  const res = await fetch("https://routellm.abacus.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Du bist der milit‰rische Taktik-Analyst von God's Eye View.
Erstelle ein pr‰gnantes taktisches Lagebriefing (SITREP) auf Deutsch.
Schema:
### ?? SITREP // LAGEBEURTEILUNG
- Status, Intensit‰t und prim‰re Bedrohung.

### ?? ZIELGEBIET & KOORDINATEN
- Zielort und betroffene Infrastruktur.

### ??? BEDROHUNGSANALYSE
- Operative Risiken und Gefahrenstufe.

### ??? TAKTISCHE MASSNAHMEN
- Schutzmaﬂnahmen.`
        },
        {
          role: "user",
          content: "Ereignis: Bab al-Mandab & Rotes Meer ó Maritimer ‹berwachungskorridor\nKategorie: RADAR\nOrt: Bab al-Mandab, Jemen/Dschibuti\nDetails: Operation Prosperity Guardian"
        }
      ],
      max_tokens: 400,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const dt = Date.now() - t0;
  console.log("Status:", res.status, "took:", dt, "ms");
  const data = await res.json();
  console.log("Briefing:\n", data?.choices?.[0]?.message?.content);
}

testOpt().catch(console.error);
