// routes/invoices.js
import express from "express";
import supabase from "../db.js";
import nodemailer from "nodemailer";

const router = express.Router();

// ── Gmail SMTP transporter ─────────────────
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ── CREATE INVOICE ─────────────────────────
router.post("/", async (req, res) => {
  const {
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    customer_city,
    customer_country,
    invoice_date,
    due_date,
    notes,
    payment_terms,
    items, // array of { description, size, quantity, unit, unit_price, total_price }
    subtotal,
    delivery_charges,
    total_amount,
    status, // draft | sent | paid | cancelled
  } = req.body;

  if (!customer_name || !items?.length)
    return res
      .status(400)
      .json({ message: "Customer name and items are required" });

  // Generate invoice number: INV-YYYYMMDD-XXXXX
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true });
  const seqPart = String((count || 0) + 1).padStart(5, "0");
  const invoice_number = `INV-${datePart}-${seqPart}`;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number,
      customer_name,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      customer_address: customer_address || null,
      customer_city: customer_city || null,
      customer_country: customer_country || null,
      invoice_date: invoice_date || new Date().toISOString().split("T")[0],
      due_date: due_date || null,
      notes: notes || null,
      payment_terms: payment_terms || "Due on receipt",
      subtotal: parseFloat(subtotal) || 0,
      delivery_charges: parseFloat(delivery_charges) || 0,
      total_amount: parseFloat(total_amount) || 0,
      status: status || "draft",
    })
    .select()
    .single();

  if (error)
    return res
      .status(500)
      .json({ message: "Failed to create invoice", details: error.message });

  // Insert line items
  const itemPayloads = items.map((item, i) => ({
    invoice_id: invoice.id,
    line_number: i + 1,
    description: item.description,
    size: item.size || null,
    quantity: parseFloat(item.quantity) || 0,
    unit: item.unit || "kg",
    unit_price: parseFloat(item.unit_price) || 0,
    total_price: parseFloat(item.total_price) || 0,
  }));

  const { error: itemsError } = await supabase
    .from("invoice_items")
    .insert(itemPayloads);

  if (itemsError)
    console.error("[Invoices] Failed to insert items:", itemsError.message);

  res
    .status(201)
    .json({
      message: "Invoice created",
      invoice: { ...invoice, invoice_items: itemPayloads },
    });
});

// ── GET ALL INVOICES ───────────────────────
router.get("/", async (req, res) => {
  const { status, search } = req.query;
  let query = supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error)
    return res.status(500).json({ message: "Failed to fetch invoices" });

  // Client-side search filter
  let result = data;
  if (search) {
    const q = search.toLowerCase();
    result = data.filter(
      (inv) =>
        inv.customer_name?.toLowerCase().includes(q) ||
        inv.invoice_number?.toLowerCase().includes(q) ||
        inv.customer_email?.toLowerCase().includes(q),
    );
  }

  res.json(result);
});

// ── GET SINGLE INVOICE ─────────────────────
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("id", req.params.id)
    .single();

  if (error || !data)
    return res.status(404).json({ message: "Invoice not found" });
  res.json(data);
});

// ── UPDATE INVOICE ─────────────────────────
router.put("/:id", async (req, res) => {
  const {
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    customer_city,
    customer_country,
    invoice_date,
    due_date,
    notes,
    payment_terms,
    items,
    subtotal,
    delivery_charges,
    total_amount,
    status,
  } = req.body;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .update({
      customer_name,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      customer_address: customer_address || null,
      customer_city: customer_city || null,
      customer_country: customer_country || null,
      invoice_date,
      due_date: due_date || null,
      notes: notes || null,
      payment_terms: payment_terms || "Due on receipt",
      subtotal: parseFloat(subtotal) || 0,
      delivery_charges: parseFloat(delivery_charges) || 0,
      total_amount: parseFloat(total_amount) || 0,
      status: status || "draft",
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error)
    return res
      .status(500)
      .json({ message: "Failed to update invoice", details: error.message });

  // Replace items — delete old, insert new
  await supabase.from("invoice_items").delete().eq("invoice_id", req.params.id);

  if (items?.length) {
    const itemPayloads = items.map((item, i) => ({
      invoice_id: invoice.id,
      line_number: i + 1,
      description: item.description,
      size: item.size || null,
      quantity: parseFloat(item.quantity) || 0,
      unit: item.unit || "kg",
      unit_price: parseFloat(item.unit_price) || 0,
      total_price: parseFloat(item.total_price) || 0,
    }));
    await supabase.from("invoice_items").insert(itemPayloads);
  }

  const { data: fresh } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("id", req.params.id)
    .single();

  res.json({ message: "Invoice updated", invoice: fresh });
});

// ── UPDATE STATUS ONLY ─────────────────────
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const valid = ["draft", "sent", "paid", "cancelled"];
  if (!valid.includes(status))
    return res.status(400).json({ message: "Invalid status" });

  const { data, error } = await supabase
    .from("invoices")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error)
    return res.status(500).json({ message: "Failed to update status" });
  res.json({ message: "Status updated", invoice: data });
});

// ── DELETE INVOICE ─────────────────────────
router.delete("/:id", async (req, res) => {
  // invoice_items deleted by cascade
  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", req.params.id);
  if (error)
    return res.status(500).json({ message: "Failed to delete invoice" });
  res.json({ message: "Invoice deleted" });
});

export default router;
