import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/guard';
import { Sms } from './auth/sms.service';
import { Google } from './auth/google';
import { Routing } from './geo/routing';
import { Eta } from './geo/eta';
import { Places } from './geo/places';
import { Realtime } from './notify/realtime.service';
import { PushService } from './notify/push.service';
import { NotifyController } from './notify/notify.controller';
import { DevController } from './dev/dev.controller';
import { SecurityLog } from './security/security-log.service';
import { Maintenance } from './security/maintenance.service';
import { StaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';
import { Matching } from './orders/matching.service';
import { OrdersService } from './orders/orders.service';
import { RatingsService } from './orders/ratings.service';
import { DriverService } from './driver/driver.service';
import { Documents } from './documents/documents.service';
import { DocumentsController } from './documents/documents.controller';
import { UserOrdersController, DriverController, RatingsController, TrackingController } from './orders/orders.controller';
import { Tracking } from './orders/tracking';
import { TrustService } from './trust/trust.service';
import { Watchdog } from './trust/watchdog';
import { MoneyService } from './money/money.service';
import { MoneyController } from './money/money.controller';
import { StaffMoneyService } from './staff/staff-money.service';
import { StaffOpsService } from './staff/staff-ops.service';

@Module({
  imports: [DbModule],
  controllers: [AuthController, NotifyController, StaffController, ...(process.env.TEST_HOOKS === '1' ? [DevController] : []), UserOrdersController, DriverController, RatingsController, TrackingController, DocumentsController, MoneyController],
  providers: [SecurityLog, Maintenance, AuthService, Sms, Google, Realtime, PushService, StaffService, Routing, Eta, Places, Matching, OrdersService, RatingsService, DriverService, Documents, Tracking, TrustService, Watchdog, MoneyService, StaffMoneyService, StaffOpsService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
