import { Inject } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

Inject(ConfigurationService)(ConfigurationController, undefined, 0);
Inject(DatabaseService)(ConfigurationService, undefined, 0);
