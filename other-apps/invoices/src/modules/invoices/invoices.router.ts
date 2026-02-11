import { z } from "zod";
import { createLogger } from "../../logger";
import { protectedClientProcedure } from "../trpc/protected-client-procedure";
import { router } from "../trpc/trpc-server";
import { GenerateInvoiceService } from "./generate-invoice.service";

const logger = createLogger("invoicesRouter");

export const invoicesRouter = router({
  generateInvoice: protectedClientProcedure
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      logger.info({ orderId: input.orderId }, "invoicesRouter.generateInvoice called");

      const service = new GenerateInvoiceService(ctx.apiClient);
      
      return service.generate(input.orderId);
    }),
});
