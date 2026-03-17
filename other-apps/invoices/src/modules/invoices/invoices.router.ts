import { z } from "zod";
import { createLogger } from "../../logger";
import { protectedClientProcedure } from "../trpc/protected-client-procedure";
import { router } from "../trpc/trpc-server";
import { GenerateInvoiceService } from "./generate-invoice.service";

const logger = createLogger("invoicesRouter");

export const invoicesRouter = router({
  generateInvoice: protectedClientProcedure
    .input(
      z.object({
        orderRef: z.preprocess(
          (value) => (Array.isArray(value) ? value[0] : value),
          z.string().min(1, "Missing order reference"),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      logger.info({ orderRef: input.orderRef }, "invoicesRouter.generateInvoice called");

      const service = new GenerateInvoiceService(ctx.apiClient);
      
      return service.generate(input.orderRef);
    }),
});
