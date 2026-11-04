import express from "express";
import supabase from "../db.js";

const router = express.Router();
const sf = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

// ── GET price list for a customer ──────────────────────────────
router.get("/:cus_id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportcustomer_product")
      .select(
        `
        id, cus_id, product_id, variant_id,
        common_name, scientific_name, image_url, category, size_range,
        purchasing_price, exfactoryprice,
        export_doc, transport_cost, loading_cost, airway_cost, forwardHandling_cost,
        multiplier, divisor, freight_type, fob_price,
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

// ── POST — add new custom price ────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportcustomer_product")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT — update existing price ────────────────────────────────
// fob_price is stored as USD: exfactoryprice_lkr / rate + handling_usd
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };

    // Fetch current record
    const { data: current, error: fetchError } = await supabase
      .from("exportcustomer_product")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;

    // Fetch latest USD rate from correct table name
    const { data: usdRateData } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const usdRate = sf(usdRateData?.rate, 304);

    // FOB stored as USD = exfactoryprice (LKR) / rate + handling costs (USD)
    const exf = sf(payload.exfactoryprice ?? current.exfactoryprice);
    const handlingUSD =
      sf(payload.export_doc ?? current.export_doc) +
      sf(payload.transport_cost ?? current.transport_cost) +
      sf(payload.loading_cost ?? current.loading_cost) +
      sf(payload.airway_cost ?? current.airway_cost) +
      sf(payload.forwardHandling_cost ?? current.forwardHandling_cost);

    const fobUSD = exf / usdRate + handlingUSD;
    payload.fob_price = parseFloat(fobUSD.toFixed(4));

    const freightType = payload.freight_type ?? current.freight_type;
    if (freightType === "air") {
      const fc45 = sf(payload.freight_cost_45kg ?? current.freight_cost_45kg);
      const fc100 = sf(
        payload.freight_cost_100kg ?? current.freight_cost_100kg,
      );
      const fc300 = sf(
        payload.freight_cost_300kg ?? current.freight_cost_300kg,
      );
      const fc500 = sf(
        payload.freight_cost_500kg ?? current.freight_cost_500kg,
      );
      payload.cnf_45kg = parseFloat((fobUSD + fc45).toFixed(4));
      payload.cnf_100kg = parseFloat((fobUSD + fc100).toFixed(4));
      payload.cnf_300kg = parseFloat((fobUSD + fc300).toFixed(4));
      payload.cnf_500kg = parseFloat((fobUSD + fc500).toFixed(4));
    } else if (freightType === "sea") {
      const fc20 = sf(payload.freight_cost_20ft ?? current.freight_cost_20ft);
      const fc40 = sf(payload.freight_cost_40ft ?? current.freight_cost_40ft);
      payload.cnf_20ft = parseFloat((fobUSD + fc20).toFixed(4));
      payload.cnf_40ft = parseFloat((fobUSD + fc40).toFixed(4));
    }

    const { data, error } = await supabase
      .from("exportcustomer_product")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE ─────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("exportcustomer_product")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Price deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk add ───────────────────────────────────────────────────
router.post("/bulk/:cus_id", async (req, res) => {
  try {
    const { cus_id } = req.params;
    const { products: selectedProducts } = req.body;
    if (!selectedProducts?.length)
      return res.status(400).json({ error: "No products provided" });

    const results = [],
      errors = [];
    for (const item of selectedProducts) {
      const { data: existing } = await supabase
        .from("exportcustomer_product")
        .select("id")
        .eq("cus_id", cus_id)
        .eq("product_id", item.product_id)
        .eq("variant_id", item.variant_id)
        .maybeSingle();

      if (existing) {
        errors.push(`${item.common_name} (${item.size_range}) already exists`);
        continue;
      }

      const { data, error } = await supabase
        .from("exportcustomer_product")
        .insert({
          cus_id: parseInt(cus_id),
          product_id: item.product_id,
          variant_id: item.variant_id,
          common_name: item.common_name,
          scientific_name: item.scientific_name || null,
          image_url: item.image_url || null,
          category: item.category,
          size_range: item.size_range,
          purchasing_price: item.purchasing_price || 0,
          exfactoryprice: item.exfactoryprice || 0,
          export_doc: 0,
          transport_cost: 0,
          loading_cost: 0,
          airway_cost: 0,
          forwardHandling_cost: 0,
          freight_type: item.freight_type || "sea",
          fob_price: item.fob_price || 0,
          multiplier: item.multiplier || 0,
          divisor: item.divisor || 1,
          freight_cost_45kg: 0,
          freight_cost_100kg: 0,
          freight_cost_300kg: 0,
          freight_cost_500kg: 0,
          cnf_45kg: 0,
          cnf_100kg: 0,
          cnf_300kg: 0,
          cnf_500kg: 0,
          freight_cost_20ft: item.freight_cost_20ft || 0,
          cnf_20ft: item.cnf_20ft || 0,
          freight_cost_40ft: item.freight_cost_40ft || 0,
          cnf_40ft: item.cnf_40ft || 0,
        })
        .select()
        .single();

      if (error) errors.push(`${item.common_name}: ${error.message}`);
      else results.push(data);
    }
    res
      .status(201)
      .json({
        inserted: results.length,
        skipped: errors.length,
        errors,
        data: results,
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
