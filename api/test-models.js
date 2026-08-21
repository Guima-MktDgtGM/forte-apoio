
const replicateToken = process.env.REPLICATE_API_TOKEN;

// Temporary prompt-tuning endpoint. POST only and secret protected so a random
// visitor cannot burn Replicate credit by opening the URL (the old GET version
// of this file did exactly that). DELETE THIS FILE once the prompt is settled.
const SECRET = process.env.TEST_SECRET || 'fp_7Qk3vR9wLzTn';

function extractUrl(output) {
  if (!output) return null;
  const value = Array.isArray(output) ? output[0] : output;
  if (typeof value === 'string') return value;
  if (value && typeof value.url === 'function') return String(value.url());
  if (value && typeof value.url === 'string') return value.url;
  return null;
}

export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secret, model, prompt, images } = req.body || {};

  if (secret !== SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!replicateToken) {
    return res.status(500).json({ error: 'REPLICATE_API_TOKEN is not configured' });
  }

  if (!model || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Missing model or images' });
  }

  try {
    const input = { prompt: prompt || '', image_input: images, output_format: 'jpg' };

    console.log(`[Test] Running ${model} with ${images.length} images`);
    const started = Date.now();

    // Raw HTTP call: the replicate 0.28 client mangles array inputs.
    // "Prefer: wait" makes Replicate hold the response until the prediction ends.
    const r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        'Content-Type': 'application/json',
        Prefer: 'wait'
      },
      body: JSON.stringify({ input })
    });

    const prediction = await r.json();

    if (!r.ok || prediction.error) {
      return res.status(500).json({ error: prediction.detail || prediction.error || 'replicate error', enviado: input });
    }

    const url = extractUrl(prediction.output);
    console.log(`[Test] Done in ${Date.now() - started}ms:`, url);

    return res.status(200).json({
      status: 'success',
      model,
      seconds: Math.round((Date.now() - started) / 1000),
      url,
      raw: url ? undefined : prediction.output,
      status_replicate: prediction.status
    });
  } catch (err) {
    console.error('[Test] Error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
