import type { NextApiRequest, NextApiResponse } from "next";
import { resolveCheckoutIdForMagicRequest } from "@/modules/magic-checkout";

function pickString(value: unknown) {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed || undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	const configuredSecret = process.env.RAZORPAY_MAGIC_INTERNAL_SECRET?.trim();
	const providedSecret = pickString(req.headers["x-magic-internal-secret"]);

	if (configuredSecret && providedSecret !== configuredSecret) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
	const reference = pickString(body.reference);
	const saleorApiUrl =
		pickString(body.saleorApiUrl) ||
		pickString(process.env.SALEOR_API_URL) ||
		pickString(process.env.NEXT_PUBLIC_SALEOR_API_URL);

	if (!reference || !saleorApiUrl) {
		return res.status(400).json({ error: "reference and saleorApiUrl are required" });
	}

	try {
		const resolved = await resolveCheckoutIdForMagicRequest(saleorApiUrl, reference);
		return res.status(200).json({
			checkoutId: resolved.checkoutId,
		});
	} catch (error) {
		return res.status(404).json({
			error: error instanceof Error ? error.message : "Unable to resolve checkout reference",
		});
	}
}
