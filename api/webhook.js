const { createClient } = require('@supabase/supabase-js');

// Initializing Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service key is secure because this is server-side
const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey) 
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
    const status = payload.status || (payload.event && payload.event.includes('approved') ? 'paid' : '');
    const isPaid = status === 'paid' || status === 'approved' || status === 'completed' || payload.event === 'charge.paid';

    if (!isPaid) {
      console.log(`Payment status not approved: ${status}. Skipping activation.`);
      return res.status(200).json({ status: "ignored", message: "Charge not paid" });
    }

    // 2. Retrieve the Unique Selfie ID (external_id / tracking parameters)
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

    console.log(`Selfie record retrieved. Candidate: ${selfieRecord.candidate}. Current Status: ${selfieRecord.status}`);

    // If already completed, return success
    if (selfieRecord.status === 'completed') {
      console.log(`Selfie already activated/completed.`);
      return res.status(200).json({ status: "success", message: "Already completed" });
    }

    // 4. Determine package limits based on Payment Amount
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

    // 5. Truncate result_url according to package limit
    let finalResultUrl = selfieRecord.result_url || "";
    if (finalResultUrl) {
      const urls = finalResultUrl.split(',');
      const truncatedUrls = urls.slice(0, photoCount);
      finalResultUrl = truncatedUrls.join(',');
    }

    console.log(`Activating selfie ID ${selfieId} with ${photoCount} photos.`);

    // 6. Update database with completed status and filtered URLs (so thank you page can release downloads)
    const { error: updateError } = await supabase
      .from('selfies')
      .update({
        status: 'completed',
        result_url: finalResultUrl,
        phone: payload.customer?.phone || selfieRecord.phone || "",
        email: payload.customer?.email || selfieRecord.email || ""
      })
      .eq('id', selfieId);

    if (updateError) {
      console.error("Failed to update Supabase record to completed:", updateError);
      return res.status(500).json({ error: "Failed to update record status" });
    }

    console.log(`Selfie ID ${selfieId} successfully marked as completed!`);

    // 7. If the customer bought more photos than the free preview generated,
    // queue the remaining ones now. /api/generate only fires the predictions
    // and returns in ~1s; Replicate then calls /api/replicate-hook for each
    // finished photo, and obrigado.html picks them up while it polls Supabase.
    const generatedCount = finalResultUrl ? finalResultUrl.split(',').filter(Boolean).length : 0;
    if (generatedCount > 0 && photoCount > generatedCount) {
      try {
        const siteUrl = process.env.PUBLIC_SITE_URL || 'https://forte-apoio.vercel.app';
        const genRes = await fetch(`${siteUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selfieId, extra: true, target: photoCount })
        });
        console.log(`Queued ${photoCount - generatedCount} extra photos for ${selfieId}. Generate API responded ${genRes.status}`);
      } catch (e) {
        // Non-blocking: the customer still keeps the photos already generated
        console.error("Failed to queue extra photos:", e);
      }
    }

    return res.status(200).json({
      status: "success",
      selfieId,
      photoCount
    });

  } catch (error) {
    console.error("Unhandled error in webhook handler:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
