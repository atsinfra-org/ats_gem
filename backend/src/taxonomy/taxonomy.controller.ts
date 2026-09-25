import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { TaxonomyService } from './taxonomy.service';

/** Reference data for filters (docs/API-CONTRACT.md §5): always public, rarely changes. */
@ApiTags('meta')
@Controller('meta')
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Public()
  @Get('states')
  states() {
    return this.taxonomy.listStates();
  }

  @Public()
  @Get('categories')
  categories() {
    return this.taxonomy.listCategories();
  }

  @Public()
  @Get('tender-types')
  tenderTypes() {
    return this.taxonomy.listTenderTypes();
  }
}
