package com.eventcommerce.pos.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
  entities = [
    LocalMetadataEntity::class,
    MenuVersionEntity::class,
    MenuItemEntity::class,
    OrderEntity::class,
    OrderItemEntity::class,
    OutboxEventEntity::class,
    PaymentAttemptEntity::class,
  ],
  version = 4,
  exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
  abstract fun localMetadata(): LocalMetadataDao
  abstract fun menu(): MenuDao
  abstract fun orders(): OrderDao
  abstract fun pendingEvents(): PendingEventDao
  abstract fun payments(): PaymentDao

  companion object {
    private const val DATABASE_NAME = "event-commerce-pos.db"

    val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          """CREATE TABLE IF NOT EXISTS `menu_versions` (`version` INTEGER NOT NULL, `eventId` TEXT NOT NULL, `menuId` TEXT NOT NULL, `activatedAtEpochMs` INTEGER NOT NULL, `sourceActor` TEXT NOT NULL, `currency` TEXT NOT NULL, `checksum` TEXT NOT NULL, `isActive` INTEGER NOT NULL, `installedAtEpochMs` INTEGER NOT NULL, PRIMARY KEY(`version`))""",
        )
        db.execSQL(
          """CREATE TABLE IF NOT EXISTS `menu_items` (`menuVersion` INTEGER NOT NULL, `itemId` TEXT NOT NULL, `skuId` TEXT NOT NULL, `name` TEXT NOT NULL, `category` TEXT NOT NULL, `priceMinor` INTEGER NOT NULL, `favourite` INTEGER NOT NULL, `sortOrder` INTEGER NOT NULL, PRIMARY KEY(`menuVersion`, `itemId`))""",
        )
        db.execSQL(
          """CREATE TABLE IF NOT EXISTS `pos_orders` (`id` TEXT NOT NULL, `eventId` TEXT NOT NULL, `salesLocationId` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `menuVersion` INTEGER NOT NULL, `state` TEXT NOT NULL, `currency` TEXT NOT NULL, `subtotalMinor` INTEGER NOT NULL, `totalMinor` INTEGER NOT NULL, `createdAtEpochMs` INTEGER NOT NULL, `updatedAtEpochMs` INTEGER NOT NULL, `closedAtEpochMs` INTEGER, PRIMARY KEY(`id`))""",
        )
        db.execSQL(
          """CREATE TABLE IF NOT EXISTS `order_items` (`id` TEXT NOT NULL, `orderId` TEXT NOT NULL, `menuItemId` TEXT NOT NULL, `skuId` TEXT NOT NULL, `name` TEXT NOT NULL, `unitPriceMinor` INTEGER NOT NULL, `quantity` INTEGER NOT NULL, `lineTotalMinor` INTEGER NOT NULL, PRIMARY KEY(`id`))""",
        )
        db.execSQL(
          """CREATE TABLE IF NOT EXISTS `outbox_events` (`eventInstanceId` TEXT NOT NULL, `eventId` TEXT NOT NULL, `eventType` TEXT NOT NULL, `aggregateType` TEXT NOT NULL, `aggregateId` TEXT NOT NULL, `eventVersion` INTEGER NOT NULL, `deviceId` TEXT NOT NULL, `sequence` INTEGER NOT NULL, `occurredAtEpochMs` INTEGER NOT NULL, `idempotencyKey` TEXT NOT NULL, `payloadJson` TEXT NOT NULL, `sentAtEpochMs` INTEGER, PRIMARY KEY(`eventInstanceId`))""",
        )
        db.execSQL(
          "CREATE UNIQUE INDEX IF NOT EXISTS `index_outbox_events_deviceId_sequence` ON `outbox_events` (`deviceId`, `sequence`)",
        )
      }
    }

    val MIGRATION_2_3 = object : Migration(2, 3) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          """CREATE TABLE IF NOT EXISTS `payment_attempts` (`id` TEXT NOT NULL, `paymentId` TEXT NOT NULL, `eventId` TEXT NOT NULL, `orderId` TEXT NOT NULL, `providerId` TEXT NOT NULL, `idempotencyKey` TEXT NOT NULL, `amountMinor` INTEGER NOT NULL, `currency` TEXT NOT NULL, `state` TEXT NOT NULL, `providerReference` TEXT, `failureCode` TEXT, `createdAtEpochMs` INTEGER NOT NULL, `updatedAtEpochMs` INTEGER NOT NULL, PRIMARY KEY(`id`))""",
        )
        db.execSQL(
          "CREATE UNIQUE INDEX IF NOT EXISTS `index_payment_attempts_idempotencyKey` ON `payment_attempts` (`idempotencyKey`)",
        )
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS `index_payment_attempts_orderId` ON `payment_attempts` (`orderId`)",
        )
      }
    }

    val MIGRATION_3_4 = object : Migration(3, 4) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          "ALTER TABLE `menu_versions` ADD COLUMN `salesLocationId` TEXT NOT NULL DEFAULT 'dev-main-bar'",
        )
      }
    }

    @Volatile private var instance: AppDatabase? = null

    fun get(context: Context): AppDatabase = instance ?: synchronized(this) {
      instance ?: create(context.applicationContext, DATABASE_NAME).also { instance = it }
    }

    fun create(context: Context, name: String): AppDatabase =
      Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, name)
        .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
        .build()
  }
}
