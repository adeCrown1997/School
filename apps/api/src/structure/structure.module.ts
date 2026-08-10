import { Module } from '@nestjs/common';
import { StructureService } from './structure.service';
import { StructureController } from './structure.controller';
import { AuthModule } from '../auth/auth.module';

/** University structure module. StructureService is exported for reuse by the
 *  students + import modules (academic-hierarchy validation). AuthModule is
 *  imported so the guards on StructureController can resolve JwtService. */
@Module({
  imports: [AuthModule],
  providers: [StructureService],
  controllers: [StructureController],
  exports: [StructureService],
})
export class StructureModule {}
