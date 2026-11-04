import express from "express";
import supabase from "../db.js";

const router = express.Router();

// Get price list for a customer — joins products table to get image_url
router.get("/:cus_id", async (req, res) => {
  try {
    const { cus_id } = req.params;

    const { data, error } = await supabase
      .from("customer_product")
      .select(
        `
        id,
        common_name,
        scientific_name,
        category,
        size_range,
        purchasing_price,
        margin,
        margin_percentage,
        selling_price,
        product_id,
        variant_id,
        image_url
      `,
      )
      .eq("cus_id", cus_id)
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
    const payload = req.body;

    const { data, error } = await supabase
      .from("customer_product")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update existing price
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    const { data, error } = await supabase
      .from("customer_product")
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

// Delete price
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("customer_product")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({ message: "Price deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
