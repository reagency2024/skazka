// Озвучка через ElevenLabs.
const API = "https://api.elevenlabs.io/v1";

export const voiceEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY);

const headers = () => ({ "xi-api-key": process.env.ELEVENLABS_API_KEY });

export async function listVoices() {
  const res = await fetch(`${API}/voices`, { headers: headers() });
  if (!res.ok) throw new Error(`ElevenLabs: ${res.status} ${await res.text()}`);
  const { voices } = await res.json();
  return voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    preview: v.preview_url,
    description: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description || v.labels?.descriptive]
      .filter(Boolean)
      .join(", "),
  }));
}

export async function synthesize(voiceId, text) {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      // Мультиязычная модель хорошо читает по-русски.
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 0.9 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
