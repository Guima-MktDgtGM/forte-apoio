import { createClient } from '@supabase/supabase-js';
import Replicate from 'replicate';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const replicateToken = process.env.REPLICATE_API_TOKEN;
const replicate = replicateToken ? new Replicate({ auth: replicateToken }) : null;

// Normalizes whatever the model returns (string, array or FileOutput) into a plain URL
function extractUrl(output) {
  if (!output) return null;
  const value = Array.isArray(output) ? output[0] : output;
  if (typeof value === 'string') return value;
  if (value && typeof value.url === 'function') return String(value.url());
  if (value && typeof value.url === 'string') return value.url;
  return null;
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { selfieId, predictionIds } = req.body || {};

    if (!selfieId || !Array.isArray(predictionIds) || predictionIds.length === 0) {
      return res.status(400).json({ error: 'Missing selfieId or predictionIds' });
    }

    if (!replicate) {
      return res.status(500).json({ error: 'Replicate token not set' });
    }

    // Read every prediction in parallel — this is a cheap metadata call
    const predictions = await Promise.all(
      predictionIds.map((id) => replicate.predictions.get(id))
    );

    const failed = predictions.find((p) => p.status === 'failed' || p.status === 'canceled');
    if (failed) {
      console.error(`[API Status] Prediction ${failed.id} ${failed.status}:`, failed.error);
      await supabase
        .from('selfies')
        .update({ status: `failed_replicate: ${failed.error || failed.status}` })
        .eq('id', selfieId);

      return res.status(200).json({
        status: 'failed',
        error: failed.error || `Prediction ${failed.status}`
      });
    }

    const done = predictions.every((p) => p.status === 'succeeded');

    if (!done) {
      const readyCount = predictions.filter((p) => p.status === 'succeeded').length;
      return res.status(200).json({
        status: 'processing',
        ready: readyCount,
        total: predictions.length
      });
    }

    const results = predictions.map((p) => extractUrl(p.output)).filter(Boolean);

    if (results.length === 0) {
      console.error(`[API Status] All predictions succeeded but no output URL for ${selfieId}`);
      return res.status(200).json({ status: 'failed', error: 'AI output URL list is empty' });
    }

    // Persist the results so obrigado.html can release the downloads after payment.
    // /api/replicate-hook can be writing to the same column at the same time, so
    // merge with whatever is already stored instead of overwriting it.
    const { data: current } = await supabase
      .from('selfies')
      .select('result_url')
      .eq('id', selfieId)
      .single();

    const stored = current && current.result_url ? current.result_url.split(',').filter(Boolean) : [];
    const merged = results.slice();
    stored.forEach((url) => {
      if (!merged.includes(url)) merged.push(url);
    });

    const { error: updateError } = await supabase
      .from('selfies')
      .update({ result_url: merged.join(',') })
      .eq('id', selfieId);

    if (updateError) {
      console.error('[API Status] Failed to save results to Supabase:', updateError);
    }

    console.log(`[API Status] Generation complete for ${selfieId}:`, merged);

    // Return the merged list so the browser sees every photo already finished,
    // including the ones queued in an earlier round that the throttle split up.
    return res.status(200).json({
      status: 'ready',
      results: merged
    });

  } catch (error) {
    console.error('[API Status] Unhandled error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
