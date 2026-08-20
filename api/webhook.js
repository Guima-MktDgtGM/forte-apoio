const { createClient } = require('@supabase/supabase-js');
const Replicate = require('replicate');

// Initializing Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service key is secure because this is server-side
const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null;

// Initializing Replicate
const replicate = process.env.REPLICATE_API_TOKEN 
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN }) 
  : null;

module.exports = async (req, res) => {
  // Allow only POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const payload = req.body;
    console.log("Cakto webhook received payload:", JSON.stringify(payload));

    // 1. Validate payment status from Cakto
    // Cakto webhook events send payment status in payload.status or payload.event
    // Common properties: status: "paid" or event: "payment.approved"
    const status = payload.status || (payload.event && payload.event.includes('approved') ? 'paid' : '');
    const isPaid = status === 'paid' || status === 'approved' || status === 'completed' || payload.event === 'charge.paid';

    if (!isPaid) {
      console.log(`Payment status not approved: ${status}. Skipping generation.`);
      return res.status(200).json({ status: "ignored", message: "Charge not paid" });
    }

    // 2. Retrieve the Unique Selfie ID (external_id / tracking parameters)
    // We look in all common places where Cakto/payment gateways allow custom metadata injection
    const selfieId = payload.external_id || 
                     (payload.metadata && payload.metadata.selfie_id) || 
                     (payload.custom_fields && payload.custom_fields.selfie_id) ||
                     payload.tracking_id ||
                     (payload.metadata && payload.metadata.custom_id) ||
                     payload.src ||
                     payload.utm_campaign ||
                     (payload.tracking && payload.tracking.src) ||
                     (payload.tracking && payload.tracking.utm_campaign);

    if (!selfieId) {
      console.error("Missing selfieId / external_id in Cakto webhook payload.");
      return res.status(400).json({ error: "Missing external_id tracking parameter" });
    }

    if (!supabase) {
      console.error("Supabase client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
      return res.status(500).json({ error: "Supabase connection error" });
    }

    // 3. Fetch user record from database
    const { data: selfieRecord, error: dbError } = await supabase
      .from('selfies')
      .select('*')
      .eq('id', selfieId)
      .single();

    if (dbError || !selfieRecord) {
      console.error(`Record not found in Supabase selfies table for ID ${selfieId}:`, dbError);
      return res.status(404).json({ error: "Selfie record not found" });
    }

    console.log(`Selfie record retrieved. Candidate: ${selfieRecord.candidate}. Status: ${selfieRecord.status}`);

    // If already generated, avoid doing it twice
    if (selfieRecord.status === 'completed' && selfieRecord.result_url) {
      console.log(`Selfie already generated: ${selfieRecord.result_url}`);
      return res.status(200).json({ status: "success", message: "Already generated", url: selfieRecord.result_url });
    }

    // Update status to processing
    await supabase.from('selfies').update({ status: 'paid' }).eq('id', selfieId);

    // 4. Determine Photo Count based on Payment Amount
    let photoCount = 3; // Default to 3 (Militância)
    const rawAmount = payload.amount || (payload.payment && payload.payment.amount) || 0;
    const amountFloat = parseFloat(rawAmount);

    if (amountFloat === 15.9 || amountFloat === 1590 || amountFloat === 15.90) {
      photoCount = 1;
    } else if (amountFloat === 19.9 || amountFloat === 1990 || amountFloat === 19.90) {
      photoCount = 5;
    } else if (amountFloat === 17.9 || amountFloat === 1790 || amountFloat === 17.90) {
      photoCount = 3;
    }

    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://forteapoio.com.br';
    const sourceImageUrl = selfieRecord.selfie_url;

    if (!sourceImageUrl) {
      console.error(`Missing selfie_url in DB record for ${selfieId}`);
      return res.status(400).json({ error: "DB record is missing selfie_url" });
    }

    if (!replicate) {
      console.error("Replicate client not configured. Set REPLICATE_API_TOKEN.");
      return res.status(500).json({ error: "Replicate token not set" });
    }

    // Resolve templates array
    const templateList = [];
    const cand = selfieRecord.candidate;
    const modelHash = process.env.REPLICATE_MODEL_VERSION || "9a423cef0b8ef6c5db1d4c556f4d411e737cd62da0e28f117c768994757c9e01";

    for (let i = 1; i <= photoCount; i++) {
      if (cand === 'lula') {
        const customUrl = process.env[`TEMPLATE_LULA_${i}`];
        templateList.push(customUrl || `${siteUrl}/imagens/exemplo-lula-${i}.jpg`);
      } else {
        const customUrl = process.env[`TEMPLATE_BOLSONARO_${i}`];
        templateList.push(customUrl || `${siteUrl}/imagens/exemplo-bolsonaro-${i}.png`);
      }
    }

    console.log(`Starting parallel Face Swap for ${photoCount} variations. Templates:`, templateList);

    // 5. Trigger Replicate Faceswap model in parallel
    let generatedUrls = [];
    try {
      const promises = templateList.map(async (templateUrl, idx) => {
        try {
          console.log(`Triggering Replicate for variation #${idx + 1} with target: ${templateUrl}`);
          const output = await replicate.run(
            `lucataco/faceswap:${modelHash}`,
            {
              input: {
                target_image: templateUrl,
                swap_image: sourceImageUrl
              }
            }
          );
          const url = Array.isArray(output) ? output[0] : output;
          return url;
        } catch (apiError) {
          console.error(`Failed to run Replicate on template #${idx + 1}:`, apiError);
          return null; // Return null so other promises can resolve
        }
      });

      const results = await Promise.all(promises);
      generatedUrls = results.filter(url => url !== null);
    } catch (parallelError) {
      console.error("Failed during parallel Replicate executions:", parallelError);
      await supabase.from('selfies').update({ status: 'failed' }).eq('id', selfieId);
      return res.status(500).json({ error: "AI Generation processes failed" });
    }

    if (generatedUrls.length === 0) {
      console.error("No images generated successfully.");
      await supabase.from('selfies').update({ status: 'failed' }).eq('id', selfieId);
      return res.status(500).json({ error: "AI output URL list is empty" });
    }

    // Save results as a comma-separated string in DB
    const resultsCsv = generatedUrls.join(',');
    console.log("Parallel generation complete. Saved CSV:", resultsCsv);

    // 6. Update database with generated image URLs list
    const { error: updateError } = await supabase
      .from('selfies')
      .update({
        status: 'completed',
        result_url: resultsCsv,
        email: payload.customer?.email || selfieRecord.email || "",
        phone: payload.customer?.phone || selfieRecord.phone || ""
      })
      .eq('id', selfieId);

    if (updateError) {
      console.error("Failed to update Supabase record with results:", updateError);
    }

    return res.status(200).json({
      status: "success",
      selfieId,
      resultCount: generatedUrls.length,
      results: generatedUrls
    });

  } catch (error) {
    console.error("Unhandled error in webhook handler:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
