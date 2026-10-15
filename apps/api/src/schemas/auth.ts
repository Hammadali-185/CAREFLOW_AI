import { z } from 'zod';

export const clinicIdSchema = z.object({
  clinicId: z.uuid('Enter a clinic id.'),
});
