const key = process.env.ABACUS_API_KEY || "s2_c73eaf96c44d4b31a96e62d6a2759591";

async function testModel(modelName, prompt) {
  const t0 = Date.now();
  try {
    const res = await fetch("https://routellm.abacus.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "Du bist ein militärischer Lageanalyst. Antworte in 3 kurzen Stichpunkten auf Deutsch. Kein langes Nachdenken." },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const dt = Date.now() - t0;
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    console.log(`[${modelName}] ${res.status} in ${dt}ms`);
    console.log("Usage:", data.usage);
    console.log("Content:", msg?.content?.slice(0, 150));
    console.log("Reasoning:", msg?.reasoning_content?.slice(0, 100) || "none");
  } catch (err) {
    console.error(`[${modelName}] Failed after ${Date.now() - t0}ms:`, err.message);
  }
}

await testModel("zai-org/GLM-5.3-Flash", "Lagebericht Bab al-Mandab.");
await testModel("gpt-4o-mini", "Lagebericht Bab al-Mandab.");
await testModel("claude-3-5-haiku", "Lagebericht Bab al-Mandab.");
