import express from "express";
import supabase from "../db.js";

const router = express.Router();

// Get price list for a customer
router.get("/:cus_id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportcustomer_productair")
      .select(
        `
        id, common_name, scientific_name, image_url, category, size_range,
        purchasing_price, exfactoryprice, export_doc, transport_cost,
        loading_cost, airway_cost, forwardHandling_cost, multiplier, divisor,
        freight_type, fob_price, product_id, variant_id,
        freight_cost_45kg, freight_cost_100kg, freight_cost_300kg, freight_cost_500kg,
        cnf_45kg, cnf_100kg, cnf_300kg, cnf_500kg,
        freight_cost_20ft, cnf_20ft, freight_cost_40ft, cnf_40ft
      `,
      )
      .eq("cus_id", req.params.cus_id)
      .order("common_name");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new custom price
router.post("/", async (req, res) => {
  try {
    const body = req.body;

    // Sanitize — ensure correct types before inserting
    const payload = {
      cus_id: parseInt(body.cus_id),
      product_id: body.product_id ? parseInt(body.product_id) : null,
      variant_id: body.variant_id
        ? Math.floor(parseFloat(body.variant_id))
        : null,
      common_name: body.common_name || null,
      scientific_name: body.scientific_name || null,
      category: body.category || null,
      image_url: body.image_url || null,
      size_range: body.size_range || "",
      purchasing_price: parseFloat(body.purchasing_price) || 0,
      exfactoryprice: parseFloat(body.exfactoryprice) || 0,
      export_doc: parseFloat(body.export_doc) || 0,
      transport_cost: parseFloat(body.transport_cost) || 0,
      loading_cost: parseFloat(body.loading_cost) || 0,
      airway_cost: parseFloat(body.airway_cost) || 0,
      forwardHandling_cost: parseFloat(body.forwardHandling_cost) || 0,
      multiplier: parseFloat(body.multiplier) || 0,
      divisor: parseFloat(body.divisor) || 1,
      freight_type: body.freight_type || "air",
      fob_price: parseFloat(body.fob_price) || 0,
      freight_cost_45kg: parseFloat(body.freight_cost_45kg) || 0,
      freight_cost_100kg: parseFloat(body.freight_cost_100kg) || 0,
      freight_cost_300kg: parseFloat(body.freight_cost_300kg) || 0,
      freight_cost_500kg: parseFloat(body.freight_cost_500kg) || 0,
      cnf_45kg: parseFloat(body.cnf_45kg) || 0,
      cnf_100kg: parseFloat(body.cnf_100kg) || 0,
      cnf_300kg: parseFloat(body.cnf_300kg) || 0,
      cnf_500kg: parseFloat(body.cnf_500kg) || 0,
      freight_cost_20ft: parseFloat(body.freight_cost_20ft) || 0,
      cnf_20ft: parseFloat(body.cnf_20ft) || 0,
      freight_cost_40ft: parseFloat(body.freight_cost_40ft) || 0,
      cnf_40ft: parseFloat(body.cnf_40ft) || 0,
    };

    console.log(
      "[exportcustomer-productsair POST] payload:",
      JSON.stringify(payload),
    );

    const { data, error } = await supabase
      .from("exportcustomer_productair")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("[exportcustomer-productsair POST] Supabase error:", error);
      throw error;
    }
    res.status(201).json(data);
  } catch (err) {
    console.error("[exportcustomer-productsair POST] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ⚠️ MUST be before PUT /:id — otherwise Express matches "recalculate" as :id
router.post("/recalculate/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: cp, error: fetchError } = await supabase
      .from("exportcustomer_productair")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !cp)
      return res.status(404).json({ error: "Row not found" });

    const { data: usdRateData } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("date", { ascending: false })
      .limit(1)
      .single();
    const usdRate = parseFloat(usdRateData?.rate) || 304;

    const totalAdditionalUSD =
      (parseFloat(cp.export_doc) || 0) +
      (parseFloat(cp.transport_cost) || 0) +
      (parseFloat(cp.loading_cost) || 0) +
      (parseFloat(cp.airway_cost) || 0) +
      (parseFloat(cp.forwardHandling_cost) || 0);

    const fobInUSD =
      parseFloat(cp.exfactoryprice) / usdRate + totalAdditionalUSD;
    const updateData = { fob_price: fobInUSD };

    const { data: customerData } = await supabase
      .from("exportcustomersair")
      .select("country, airport_code")
      .eq("cus_id", cp.cus_id)
      .single();

    if (customerData) {
      let q = supabase
        .from("freight_rates")
        .select("*")
        .eq("country", customerData.country)
        .order("date", { ascending: false })
        .limit(1);
      if (customerData.airport_code)
        q = supabase
          .from("freight_rates")
          .select("*")
          .eq("country", customerData.country)
          .eq("airport_code", customerData.airport_code)
          .order("date", { ascending: false })
          .limit(1);

      const { data: airRates } = await q;
      const airRate = airRates?.[0];
      const m = parseFloat(cp.multiplier) > 0 ? parseFloat(cp.multiplier) : 1;
      const d = parseFloat(cp.divisor) > 0 ? parseFloat(cp.divisor) : 1;

      if (airRate) {
        const fc45 = (m * parseFloat(airRate.rate_45kg)) / d;
        const fc100 = (m * parseFloat(airRate.rate_100kg)) / d;
        const fc300 = (m * parseFloat(airRate.rate_300kg)) / d;
        const fc500 = (m * parseFloat(airRate.rate_500kg)) / d;
        Object.assign(updateData, {
          freight_cost_45kg: fc45,
          freight_cost_100kg: fc100,
          freight_cost_300kg: fc300,
          freight_cost_500kg: fc500,
          cnf_45kg: fobInUSD + fc45,
          cnf_100kg: fobInUSD + fc100,
          cnf_300kg: fobInUSD + fc300,
          cnf_500kg: fobInUSD + fc500,
        });
      }
    }

    const { data, error: updateError } = await supabase
      .from("exportcustomer_productair")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();
    if (updateError) throw updateError;
    res.json(data);
  } catch (err) {
    console.error("Error in recalculate:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update existing price
router.put("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportcustomer_productair")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete price
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("exportcustomer_productair")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Price deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
