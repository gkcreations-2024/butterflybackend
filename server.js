require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require("path");
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

const PORT = process.env.PORT || 4000;

// static files (CSS, JS, images) serve
app.use("/public", express.static(path.join(__dirname, "public")));

// index.html serve
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Setup nodemailer transport
// Resend API client
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);



function createInvoicePdfBuffer(order) {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // Currency label (use Rs. to avoid any font glyph issues)
      const currency = "Rs.";

      // Layout measurements
      const startX = doc.page.margins.left;
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Column widths (these sum must be <= contentWidth)
      const itemWidth = 260;
      const qtyWidth = 60;
      const priceWidth = 100;
      const totalWidth = contentWidth - itemWidth - qtyWidth - priceWidth;

      const colX = {
        item: startX,
        qty: startX + itemWidth,
        price: startX + itemWidth + qtyWidth,
        total: startX + itemWidth + qtyWidth + priceWidth,
      };

      // ---------- Header ----------
      doc.font("Helvetica-Bold").fontSize(20).text("Butterfly Crackers", startX);
      doc.font("Helvetica").fontSize(11).text("Sivakasi", startX);
      doc.moveDown(1);

      // ---------- Order meta ----------
      doc.fontSize(10)
        .text(`Invoice Date: ${new Date().toLocaleString()}`, startX)
        .text(`Order ID: ${order.orderId || "ORD-" + Date.now()}`, startX);
      doc.moveDown(0.8);

      // ---------- Customer details ----------
      doc.font("Helvetica-Bold").fontSize(12).text("Customer Details:");
      doc.font("Helvetica").fontSize(10)
        .text(`Name: ${order.customer.name || "-"}`)
        .text(`Phone: ${order.customer.phone || "-"}`)
        .text(`WhatsApp: ${order.customer.whatsapp || "-"}`)
        .text(`Email: ${order.customer.email || "-"}`)
        .text(`Pincode: ${order.customer.pincode || "-"}`)
        .text(`District: ${order.customer.district || "-"}`);
      doc.moveDown(0.8);

      // ---------- Items table header ----------
      doc.font("Helvetica-Bold").fontSize(12).text("Items:");
      doc.moveDown(0.3);

      const headerY = doc.y;
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Product", colX.item, headerY, { width: itemWidth });
      doc.text("Qty", colX.qty, headerY, { width: qtyWidth, align: "right" });
      doc.text("Price", colX.price, headerY, { width: priceWidth, align: "right" });
      doc.text("Total", colX.total, headerY, { width: totalWidth, align: "right" });

      doc.moveDown(0.4);
      // separator line
      doc.moveTo(startX, doc.y).lineTo(startX + contentWidth, doc.y).stroke();

      // ---------- Table rows ----------
      let mrpTotal = 0;
      let netTotal = 0;

      doc.font("Helvetica").fontSize(10);

      order.items.forEach((it) => {
        // Handle page break if we are near the bottom
        if (doc.y > doc.page.height - doc.page.margins.bottom - 100) {
          doc.addPage();
        }

        const rowY = doc.y + 5;
        const name = String(it.name || it.productName || "Product");
        const qty = parseInt(it.qty || 0, 10) || 0;
        const price = Number(it.price || 0) || 0;
        const oldPrice = Number(it.oldPrice || price) || price;
        const lineTotal = qty * price;
        const lineMrp = qty * oldPrice;

        mrpTotal += lineMrp;
        netTotal += lineTotal;

        // Product column (wrap inside itemWidth)
        doc.text(name, colX.item, rowY, { width: itemWidth });

        // Numeric columns — RIGHT aligned inside fixed widths
        doc.text(String(qty), colX.qty, rowY, { width: qtyWidth, align: "right" });
        doc.text(`${currency} ${price.toFixed(2)}`, colX.price, rowY, { width: priceWidth, align: "right" });
        doc.text(`${currency} ${lineTotal.toFixed(2)}`, colX.total, rowY, { width: totalWidth, align: "right" });

        doc.moveDown(1);
      });

      // ---------- Totals ----------
      doc.moveDown(0.2);
      doc.moveTo(startX, doc.y).lineTo(startX + contentWidth, doc.y).stroke();
      const discount = mrpTotal - netTotal;
      doc.moveDown(0.5);

      // Right-aligned totals block
      doc.font("Helvetica").fontSize(11)
        .text(`MRP Total: ${currency} ${mrpTotal.toFixed(2)}`, startX, doc.y, { width: contentWidth, align: "right" })
        .text(`Discount: -${currency} ${discount.toFixed(2)}`, startX, doc.y, { width: contentWidth, align: "right" });

      doc.font("Helvetica-Bold")
        .text(`Net Total: ${currency} ${netTotal.toFixed(2)}`, startX, doc.y, { width: contentWidth, align: "right" });

      doc.moveDown(1);

      // Packing info
      doc.font("Helvetica").fontSize(10).text("Packing Charges: Free", startX);
      doc.moveDown(1);

      // Footer (no minimum order line as requested)
      doc.font("Helvetica-Oblique").fontSize(9).text(
        "Thank you for ordering from Butterfly Crackers.",
        { align: "center" }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}








// API endpoint to submit order
app.post('https://butterflybackend.onrender.com/api/submit-order', async (req, res) => {
  try {
    const { cart = [], customer = {} } = req.body;

    // Basic validations
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    if (!customer || !customer.email || !customer.name || !customer.phone) {
      return res.status(400).json({ error: 'Missing customer details' });
    }

    // compute totals
    let netTotal = 0;
    cart.forEach(item => {
      netTotal += (parseFloat(item.price || 0) * parseInt(item.qty || 0));
    });

    const order = {
      orderId: 'ORD-' + Date.now(),
      items: cart,
      customer,
      netTotal
    };

    // create PDF buffer
    const pdfBuffer = await createInvoicePdfBuffer(order);
    const pdfBase64 = pdfBuffer.toString('base64'); // Resend requires base64 for attachments

    // send emails using Resend
    await Promise.all([
      // To seller
      resend.emails.send({
        from: `${process.env.FROM_NAME} <${process.env.SMTP_USER}>`,
        to: process.env.SELLER_EMAIL,
        subject: `New Order ${order.orderId} - ₹${netTotal}`,
        text: `New order received.\nOrder ID: ${order.orderId}\nCustomer: ${customer.name}\nNet Total: ₹${netTotal}`,
        attachments: [
          {
            name: `${order.orderId}.pdf`,
            data: pdfBase64,
            type: "application/pdf"
          }
        ]
      }),
      // To customer
      resend.emails.send({
        from: `${process.env.FROM_NAME} <${process.env.SMTP_USER}>`,
        to: customer.email,
        subject: `Your Order Confirmation ${order.orderId}`,
        text: `Thanks for ordering from Butterfly Crackers.\nOrder ID: ${order.orderId}\nNet Total: ₹${netTotal}`,
        attachments: [
          {
            name: `${order.orderId}.pdf`,
            data: pdfBase64,
            type: "application/pdf"
          }
        ]
      })
    ]);

    // respond success
    res.json({ success: true, orderId: order.orderId, netTotal });

  } catch (err) {
    console.error('submit-order error', err);
    res.status(500).json({ error: 'Failed to submit order', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at: http://localhost:${PORT}`);
});