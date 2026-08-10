import { Injectable } from '@nestjs/common';
import { PrismaTx } from '../prisma/prisma.service';

/**
 * Generates the INTERNAL student id (our surrogate key shown to users, distinct
 * from the matriculation number). The matriculation number itself is supplied
 * by the authorized admin/import (it originates from the admission/JAMB
 * process — institution authority) and is only validated for uniqueness; it is
 * NEVER generated from student input.
 *
 * The internal id is `STU` + admission year + a zero-padded value drawn from a
 * real Postgres SEQUENCE (`student_id_seq`, created in guards.sql). nextval() is
 * atomic and never hands the same number to two concurrent transactions, so no
 * read-modify-write race is possible. The number is allocated inside the SAME
 * transaction as the student insert; a rolled-back create simply leaves a gap
 * (sequences are not transactional — an acceptable, standard trade-off for a
 * surrogate key).
 *
 * NOTE (Q-08, flagged in open questions): the matriculation-number FORMAT and
 * any institutional checksum rules are institution-specific and are
 * intentionally NOT invented here. This service only generates the internal id.
 */
@Injectable()
export class IdGeneratorService {
  private static readonly PREFIX = 'STU';

  /**
   * Allocate the next internal student id within `tx`.
   * @param year admission/entry year to embed (keeps ids human-scannable).
   */
  async nextStudentId(tx: PrismaTx, year: number): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('student_id_seq') AS nextval
    `;
    const seq = rows[0]?.nextval ?? 0n;
    return `${IdGeneratorService.PREFIX}${year}${seq.toString().padStart(6, '0')}`;
  }
}
