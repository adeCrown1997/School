import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StudentsService } from '../students.service';
import { ProfileService } from './profile.service';
import { AuthPrincipal } from '../../common/auth-principal';

/**
 * The change-request workflow is the ONLY way a student influences their master
 * record, and it never mutates identity directly. The security rules proven here:
 *   • self-service is refused to any caller with no linked student record;
 *   • separation of duties — a reviewer may not decide their OWN request (also a
 *     DB CHECK, tested here at the service layer);
 *   • a decided request cannot be re-decided;
 *   • approval routes the correction through StudentsService.applyProtectedAmendment
 *     (the sole protected-write path) rather than writing the record directly.
 */
function build(over: { prisma?: Partial<PrismaService>; students?: Partial<StudentsService> }) {
  const prisma = { ...over.prisma } as unknown as PrismaService;
  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  const students = {
    applyProtectedAmendment: jest.fn().mockResolvedValue({}),
    ...over.students,
  } as unknown as StudentsService;
  return {
    service: new ProfileService(prisma, audit, students),
    students,
  };
}

const student = (studentRecordId: string | null): AuthPrincipal => ({
  userId: 'u-student',
  userType: 'STUDENT',
  email: 's@uni.example',
  fullName: 'Student',
  permissions: [],
  scopedPermissions: [],
  studentRecordId,
});

const registrar: AuthPrincipal = {
  userId: 'u-registrar',
  userType: 'STAFF',
  email: 'registry@uni.example',
  fullName: 'Registrar',
  permissions: ['change_requests.review'],
  scopedPermissions: [{ permission: 'change_requests.review', scope: { scopeType: 'GLOBAL' } }],
};

const ctx = { ip: '127.0.0.1', userAgent: 'jest' };

describe('ProfileService self-service ownership', () => {
  it('refuses to create a change request for a caller with no linked record', async () => {
    const { service } = build({});
    await expect(
      service.createChangeRequest(
        student(null),
        { fieldKey: 'surname', requestedValue: 'X', reason: 'because' },
        ctx,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ProfileService.reviewChangeRequest (separation of duties)', () => {
  const pendingCr = (requestedById: string) => ({
    id: 'cr1',
    status: 'PENDING',
    requestedById,
    fieldKey: 'surname',
    requestedValue: 'Corrected',
    studentRecordId: 'rec1',
    studentRecord: { facultyId: 'f1', departmentId: 'd1', programmeId: 'p1' },
  });

  it('forbids a reviewer from deciding their OWN request', async () => {
    const { service } = build({
      prisma: {
        profileChangeRequest: {
          findUnique: jest.fn().mockResolvedValue(pendingCr(registrar.userId)),
        } as never,
      },
    });
    await expect(
      service.reviewChangeRequest('cr1', { decision: 'APPROVE' }, registrar, ctx),
    ).rejects.toThrow(/separation of duties/);
  });

  it('refuses to re-decide a request that is not PENDING', async () => {
    const { service } = build({
      prisma: {
        profileChangeRequest: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...pendingCr('someone-else'), status: 'APPROVED' }),
        } as never,
      },
    });
    await expect(
      service.reviewChangeRequest('cr1', { decision: 'APPROVE' }, registrar, ctx),
    ).rejects.toThrow(/already been decided/);
  });

  it('404s for a missing request', async () => {
    const { service } = build({
      prisma: {
        profileChangeRequest: { findUnique: jest.fn().mockResolvedValue(null) } as never,
      },
    });
    await expect(
      service.reviewChangeRequest('ghost', { decision: 'REJECT' }, registrar, ctx),
    ).rejects.toThrow(NotFoundException);
  });

  it('on APPROVE, applies the correction via the protected-amendment path (never a direct write)', async () => {
    const applyProtectedAmendment = jest.fn().mockResolvedValue({});
    const { service, students } = build({
      prisma: {
        profileChangeRequest: {
          findUnique: jest
            .fn()
            // 1st call: load the pending CR; 2nd call: return the refreshed row.
            .mockResolvedValueOnce(pendingCr('someone-else'))
            .mockResolvedValueOnce({ id: 'cr1', status: 'APPROVED' }),
        } as never,
      },
      students: { applyProtectedAmendment },
    });

    await service.reviewChangeRequest('cr1', { decision: 'APPROVE' }, registrar, ctx);

    expect(students.applyProtectedAmendment).toHaveBeenCalledWith(
      'rec1',
      { surname: 'Corrected' },
      expect.objectContaining({ action: 'change_request.approve', changeRequestId: 'cr1' }),
      registrar,
      expect.any(Function),
    );
  });

  it('on APPROVE of a gender field, coerces the stored text to a valid enum value', async () => {
    const applyProtectedAmendment = jest.fn().mockResolvedValue({});
    const { service } = build({
      prisma: {
        profileChangeRequest: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({
              id: 'cr1',
              status: 'PENDING',
              requestedById: 'someone-else',
              fieldKey: 'gender',
              requestedValue: 'female',
              studentRecordId: 'rec1',
              studentRecord: { facultyId: 'f1', departmentId: 'd1', programmeId: 'p1' },
            })
            .mockResolvedValueOnce({ id: 'cr1', status: 'APPROVED' }),
        } as never,
      },
      students: { applyProtectedAmendment },
    });

    await service.reviewChangeRequest('cr1', { decision: 'APPROVE' }, registrar, ctx);
    expect(applyProtectedAmendment).toHaveBeenCalledWith(
      'rec1',
      { gender: 'FEMALE' },
      expect.anything(),
      registrar,
      expect.any(Function),
    );
  });
});
