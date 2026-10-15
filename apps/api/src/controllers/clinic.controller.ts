import type { Request, Response } from 'express';

type ClinicAccess = {
  clinic: { id: string; name: string; slug: string; timezone: string };
  role: 'owner' | 'staff' | 'patient';
};

export function createClinicController() {
  return {
    member(_req: Request, res: Response) {
      const access = res.locals.clinicAccess as ClinicAccess;
      res.status(200).json({ ...access, access: 'member' });
    },
    staff(_req: Request, res: Response) {
      const access = res.locals.clinicAccess as ClinicAccess;
      res.status(200).json({ clinicId: access.clinic.id, role: access.role, access: 'staff' });
    },
    admin(_req: Request, res: Response) {
      const access = res.locals.clinicAccess as ClinicAccess;
      res.status(200).json({
        clinicId: access.clinic.id,
        role: access.role,
        access: 'administrator',
      });
    },
  };
}

export type ClinicController = ReturnType<typeof createClinicController>;
