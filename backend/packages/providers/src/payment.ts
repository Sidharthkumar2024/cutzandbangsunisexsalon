import type { PaymentProvider } from "@cutz/types";

/**
 * MVP payment provider: builds a UPI intent string the frontend renders as a
 * QR. Payment is marked manually after the customer pays; gateway
 * reconciliation can be added behind this same interface later.
 */
export class UpiPaymentProvider implements PaymentProvider {
  private vpa = process.env.UPI_VPA ?? "salon@upi";
  private payee = process.env.UPI_PAYEE ?? "Cutz & Bangs";

  async createIntent(input: { amountMinor: number; reference: string }): Promise<{ qrPayload: string }> {
    const amount = (input.amountMinor / 100).toFixed(2);
    const params = new URLSearchParams({
      pa: this.vpa,
      pn: this.payee,
      am: amount,
      cu: "INR",
      tn: input.reference,
    });
    return { qrPayload: `upi://pay?${params.toString()}` };
  }
}
