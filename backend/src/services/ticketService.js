import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';

export function generateTicketCode() {
  return `THK-${uuidv4().slice(0, 8).toUpperCase()}`;
}

export function buildTicketPdf({ ticketCode, eventTitle, attendeeName, phoneNumber, amount, bookingId, eventDate }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A5', margin: 36 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Twende Hike Kenya', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('black').text('Digital Booking Pass', { align: 'center' });
      doc.moveDown();

      doc.fontSize(14).text(eventTitle, { bold: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Booking ID: ${bookingId}`);
      doc.text(`Ticket Code: ${ticketCode}`);
      doc.text(`Attendee: ${attendeeName}`);
      doc.text(`Phone: ${phoneNumber}`);
      doc.text(`Event Date: ${eventDate}`);
      doc.text(`Amount: KES ${Number(amount).toLocaleString()}`);

      doc.moveDown();
      doc.rect(40, 220, 330, 100).stroke();
      doc.fontSize(11).text('Unique pass validation', 55, 245);
      doc.text(`Pass ${ticketCode} is valid for a single attendee and must be presented at check-in.`, 55, 270);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
