import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/decorators';
import { PERMISSIONS } from '../../rbac/permissions.catalog';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthPrincipal } from '../../common/auth-principal';
import { StudentImportService } from './student-import.service';
import { ImportCommitDto } from './dto/import.dto';

/** Uploaded file shape (multer memory storage — buffer kept in RAM, never disk). */
interface UploadedImport {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
};

/**
 * Bulk student import endpoints. Both require students.import and run the actor
 * through the same scope checks as single create (per-row, in the service).
 * `preview` is a safe dry-run (no writes); `commit` performs the atomic import.
 */
@Controller('students/import')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StudentImportController {
  constructor(private readonly importer: StudentImportService) {}

  @Post('preview')
  @RequirePermissions(PERMISSIONS.STUDENTS_IMPORT)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async preview(
    @UploadedFile() file: UploadedImport | undefined,
    @Body('defaultAdmissionSessionId') defaultAdmissionSessionId: string | undefined,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.assertFile(file);
    return this.importer.preview(file!, user, defaultAdmissionSessionId);
  }

  @Post('commit')
  @RequirePermissions(PERMISSIONS.STUDENTS_IMPORT)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async commit(
    @UploadedFile() file: UploadedImport | undefined,
    @Body() dto: ImportCommitDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.assertFile(file);
    return this.importer.commit(file!, dto, user);
  }

  private assertFile(file: UploadedImport | undefined): void {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Upload a .csv or .xlsx file in the "file" field');
    }
  }
}
