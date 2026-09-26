import { Controller, Get, Query } from '@nestjs/common';
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
  @Get('sources')
  sources() {
    return this.taxonomy.listSources();
  }

  @Public()
  @Get('districts')
  districts(@Query('state') state?: string) {
    return this.taxonomy.listDistricts(state && /^[A-Z]{2}$/.test(state) ? state : undefined);
  }

  @Public()
  @Get('tender-types')
  tenderTypes() {
    return this.taxonomy.listTenderTypes();
  }
}
