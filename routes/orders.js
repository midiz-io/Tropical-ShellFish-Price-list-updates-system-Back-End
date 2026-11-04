// routes/orders.js
import express from "express";
import supabase from "../db.js";
import nodemailer from "nodemailer";

const router = express.Router();

// ── Gmail SMTP transporter ─────────────────
// Uses Gmail App Password — no third party service needed.
// Setup: myaccount.google.com/apppasswords → generate 16-char password
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // SSL
  auth: {
    user: process.env.EMAIL_USER, // your Gmail address
    pass: process.env.EMAIL_PASS, // 16-char app password (no spaces)
  },
});

// Verify connection on startup
transporter.verify((err) => {
  if (err) console.error("[Email] Gmail SMTP connection failed:", err.message);
  else console.log("[Email] Gmail SMTP ready ✓");
});

// ── HTML builders ──────────────────────────
function itemRows(items) {
  return items
    .map(
      (i) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">
          ${i.common_name}${i.size_range ? ` <span style="color:#64748b;">(${i.size_range})</span>` : ""}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;text-align:center;">
          ${i.quantity} ${i.unit || "kg"}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;text-align:right;">
          ${parseFloat(i.unit_price) > 0 ? `Rs. ${parseFloat(i.unit_price).toFixed(2)}` : "—"}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#0d47a1;text-align:right;">
          ${parseFloat(i.total_price) > 0 ? `Rs. ${parseFloat(i.total_price).toFixed(2)}` : "—"}
        </td>
      </tr>`,
    )
    .join("");
}

function adminHtml(order, items) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:linear-gradient(135deg,#0d47a1,#1565c0);border-radius:10px 10px 0 0;padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Tropical Shellfish (Pvt) Ltd</p>
        <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">🐚 New Order Received</h1>
      </td>
      <td align="right">
        <div style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:10px 16px;text-align:center;">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;">Order</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#fff;">#${order.id}</p>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;padding:28px 32px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;padding-bottom:10px;">Customer Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;width:38%;">Name</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;font-weight:600;">${order.customer_name}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Email</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">${order.customer_email}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Phone</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">${order.customer_phone || "—"}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Address</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">
          ${order.delivery_address}${order.delivery_city ? `, ${order.delivery_city}` : ""}${order.delivery_country ? `, ${order.delivery_country}` : ""}
        </td>
      </tr>
      ${
        order.preferred_delivery_date
          ? `
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Preferred Date</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">
          ${new Date(order.preferred_delivery_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </td>
      </tr>`
          : ""
      }
      ${
        order.special_notes
          ? `
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Notes</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">${order.special_notes}</td>
      </tr>`
          : ""
      }
    </table>

    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;padding-bottom:10px;">Order Items</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Product</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Qty</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Unit Price</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Total</th>
      </tr></thead>
      <tbody>${itemRows(items)}</tbody>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td style="background:linear-gradient(135deg,#0d47a1,#1565c0);border-radius:8px;padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.85);">Order Total</td>
          <td align="right" style="font-size:20px;font-weight:800;color:#fff;">Rs. ${parseFloat(order.total_amount).toFixed(2)}</td>
        </tr></table>
      </td></tr>
    </table>

    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#92400e;">
        ⚡ <strong>Action required:</strong> Log in to the admin dashboard and update this order's status.
      </p>
    </div>
  </td></tr>

  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 10px 10px;padding:18px 32px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Tropical Shellfish (Pvt) Ltd · Fresh &amp; Frozen Seafood Exporters · Sri Lanka</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

function customerHtml(order, items) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:linear-gradient(135deg,#0d47a1,#1565c0);border-radius:10px 10px 0 0;padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Tropical Shellfish (Pvt) Ltd</p>
        <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">🐚 Order Confirmed</h1>
      </td>
      <td align="right">
        <div style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:10px 16px;text-align:center;">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;">Order</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#fff;">#${order.id}</p>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;padding:28px 32px;">
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:18px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:15px;color:#166534;font-weight:600;">✅ Thank you for your order, ${order.customer_name}!</p>
      <p style="margin:8px 0 0;font-size:13px;color:#15803d;line-height:1.6;">
        We've received your order and our team will review it shortly. You'll hear from us to confirm delivery.
      </p>
    </div>

    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;padding-bottom:10px;">Your Order</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Product</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Qty</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Unit Price</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Total</th>
      </tr></thead>
      <tbody>${itemRows(items)}</tbody>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:linear-gradient(135deg,#0d47a1,#1565c0);border-radius:8px;padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.85);">Order Total</td>
          <td align="right" style="font-size:20px;font-weight:800;color:#fff;">Rs. ${parseFloat(order.total_amount).toFixed(2)}</td>
        </tr></table>
      </td></tr>
    </table>

    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;padding-bottom:10px;">Delivery Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;width:38%;">Deliver To</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">
          ${order.delivery_address}${order.delivery_city ? `, ${order.delivery_city}` : ""}${order.delivery_country ? `, ${order.delivery_country}` : ""}
        </td>
      </tr>
      ${
        order.preferred_delivery_date
          ? `
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Preferred Date</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">
          ${new Date(order.preferred_delivery_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </td>
      </tr>`
          : ""
      }
      ${
        order.special_notes
          ? `
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;font-weight:600;">Notes</td>
        <td style="padding:5px 0;font-size:13px;color:#1e293b;">${order.special_notes}</td>
      </tr>`
          : ""
      }
    </table>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:18px 20px;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1d4ed8;">What happens next?</p>
      <p style="margin:3px 0;font-size:13px;color:#1e40af;">1. &nbsp; Our team reviews your order</p>
      <p style="margin:3px 0;font-size:13px;color:#1e40af;">2. &nbsp; We contact you to confirm delivery timing</p>
      <p style="margin:3px 0;font-size:13px;color:#1e40af;">3. &nbsp; You receive a status update when your order ships</p>
    </div>
  </td></tr>

  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 10px 10px;padding:18px 32px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Tropical Shellfish (Pvt) Ltd · Fresh &amp; Frozen Seafood Exporters · Sri Lanka</p>
    <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1;">Questions? Reply to this email or contact us directly.</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

function statusHtml(order, statusLabel) {
  const colors = {
    "✅ Order Confirmed": { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
    "⚙️ Order Processing": {
      bg: "#faf5ff",
      border: "#e9d5ff",
      text: "#6b21a8",
    },
    "🚢 Order Shipped": { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    "📦 Order Delivered": { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
    "❌ Order Cancelled": { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  };
  const c = colors[statusLabel] || colors["✅ Order Confirmed"];
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="500" cellpadding="0" cellspacing="0" style="max-width:500px;width:100%;">
  <tr><td style="background:linear-gradient(135deg,#0d47a1,#1565c0);border-radius:10px 10px 0 0;padding:24px 28px;">
    <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.6);">Tropical Shellfish (Pvt) Ltd</p>
    <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#fff;">🐚 Order Update</h1>
  </td></tr>
  <tr><td style="background:#fff;padding:28px;">
    <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">Hi <strong>${order.customer_name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
      Your order <strong>#${order.id}</strong> status has been updated to:
    </p>
    <div style="background:${c.bg};border:2px solid ${c.border};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0;font-size:22px;font-weight:800;color:${c.text};">${statusLabel}</p>
    </div>
    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
      Thank you for choosing Tropical Shellfish (Pvt) Ltd. If you have any questions, reply to this email.
    </p>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 10px 10px;padding:16px 28px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Tropical Shellfish (Pvt) Ltd · Fresh &amp; Frozen Seafood Exporters · Sri Lanka</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

// ── CREATE ORDER ───────────────────────────
router.post("/", async (req, res) => {
  const {
    customer_id,
    customer_name,
    customer_email,
    customer_phone,
    delivery_address,
    delivery_city,
    delivery_country,
    preferred_delivery_date,
    special_notes,
    items,
  } = req.body;

  if (!customer_id || !delivery_address || !items?.length)
    return res
      .status(400)
      .json({ message: "Customer, delivery address and items are required" });

  const total_amount = items.reduce(
    (sum, i) => sum + (parseFloat(i.total_price) || 0),
    0,
  );

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id,
      customer_name,
      customer_email,
      customer_phone,
      delivery_address,
      delivery_city,
      delivery_country,
      preferred_delivery_date: preferred_delivery_date || null,
      special_notes,
      total_amount: parseFloat(total_amount.toFixed(2)),
      status: "pending",
    })
    .select()
    .single();

  if (orderError)
    return res
      .status(500)
      .json({ message: "Failed to create order", details: orderError.message });

  const itemPayloads = items.map((i) => ({
    order_id: order.id,
    product_id: i.product_id || null,
    variant_id: i.variant_id || null,
    common_name: i.common_name,
    scientific_name: i.scientific_name || null,
    image_url: i.image_url || null,
    size_range: i.size_range || null,
    unit: i.unit || "kg",
    quantity: parseFloat(i.quantity) || 1,
    unit_price: parseFloat(i.unit_price) || 0,
    total_price: parseFloat(i.total_price) || 0,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(itemPayloads);

  if (itemsError)
    console.error("[Orders] Failed to insert items:", itemsError.message);

  // Send emails non-blocking
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

  transporter
    .sendMail({
      from: `"Tropical Shellfish BMS" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `🐚 New Order #${order.id} — ${order.customer_name}`,
      html: adminHtml(order, itemPayloads),
    })
    .catch((e) =>
      console.error("[Email] Admin notification failed:", e.message),
    );

  transporter
    .sendMail({
      from: `"Tropical Shellfish (Pvt) Ltd" <${process.env.EMAIL_USER}>`,
      to: order.customer_email,
      subject: `Order Confirmation #${order.id} — Tropical Shellfish`,
      html: customerHtml(order, itemPayloads),
    })
    .catch((e) =>
      console.error("[Email] Customer confirmation failed:", e.message),
    );

  res.status(201).json({ message: "Order placed successfully", order });
});

// ── GET ORDERS FOR CUSTOMER ────────────────
router.get("/customer/:customer_id", async (req, res) => {
  const { data, error } = await supabase
    .from("orders")
    .select(`*, order_items(*)`)
    .eq("customer_id", req.params.customer_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ message: "Failed to fetch orders" });
  res.json(data);
});

// ── GET SINGLE ORDER ───────────────────────
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("orders")
    .select(`*, order_items(*)`)
    .eq("id", req.params.id)
    .single();

  if (error || !data)
    return res.status(404).json({ message: "Order not found" });
  res.json(data);
});

// ── ADMIN: GET ALL ORDERS ──────────────────
router.get("/", async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from("orders")
    .select(`*, order_items(*)`)
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ message: "Failed to fetch orders" });
  res.json(data);
});

// ── ADMIN: UPDATE ORDER STATUS ─────────────
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const validStatuses = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
  ];
  if (!validStatuses.includes(status))
    return res.status(400).json({ message: "Invalid status" });

  const { data, error } = await supabase
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error)
    return res.status(500).json({ message: "Failed to update status" });

  const statusLabels = {
    confirmed: "✅ Order Confirmed",
    processing: "⚙️ Order Processing",
    shipped: "🚢 Order Shipped",
    delivered: "📦 Order Delivered",
    cancelled: "❌ Order Cancelled",
  };

  if (statusLabels[status]) {
    transporter
      .sendMail({
        from: `"Tropical Shellfish (Pvt) Ltd" <${process.env.EMAIL_USER}>`,
        to: data.customer_email,
        subject: `Order #${data.id} ${statusLabels[status]} — Tropical Shellfish`,
        html: statusHtml(data, statusLabels[status]),
      })
      .catch((e) => console.error("[Email] Status email failed:", e.message));
  }

  res.json({ message: "Status updated", order: data });
});

// ── ADMIN: DELETE ORDER ────────────────────
router.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ message: "Failed to delete order" });
  res.json({ message: "Order deleted" });
});

export default router;
