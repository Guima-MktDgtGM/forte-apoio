import Replicate from 'replicate';

const replicateToken = process.env.REPLICATE_API_TOKEN;

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!replicateToken) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN is not configured on Vercel" });
  }

  try {
    const replicate = new Replicate({ auth: replicateToken });

    console.log("[Debug API] Fetching latest predictions...");
    const predictions = await replicate.predictions.list();

    const results = predictions.results.slice(0, 5).map(pred => ({
      id: pred.id,
      model: pred.model,
      version: pred.version,
      status: pred.status,
      error: pred.error,
      output: pred.output,
      logs: pred.logs,
      created_at: pred.created_at
    }));

    return res.status(200).json({
      status: "success",
      predictions: results
    });

  } catch (err) {
    console.error("[Debug API] Error fetching predictions:", err);
    return res.status(500).json({ error: err.message || err });
  }
};
