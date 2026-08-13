CREATE TABLE organisations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  timezone text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (id, organisation_id)
);

CREATE TABLE sales_locations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  UNIQUE (id, organisation_id)
);

CREATE TABLE inventory_locations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  UNIQUE (id, organisation_id)
);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id)
);

CREATE TABLE skus (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  product_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  code text NOT NULL CHECK (length(trim(code)) > 0),
  unit_name text NOT NULL CHECK (length(trim(unit_name)) > 0),
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, organisation_id) REFERENCES products(id, organisation_id),
  UNIQUE (organisation_id, code),
  UNIQUE (id, organisation_id)
);

CREATE TABLE menus (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  UNIQUE (id, organisation_id)
);

CREATE TABLE menu_assignments (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  menu_id uuid NOT NULL,
  sales_location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (menu_id, organisation_id) REFERENCES menus(id, organisation_id),
  FOREIGN KEY (sales_location_id, organisation_id) REFERENCES sales_locations(id, organisation_id),
  UNIQUE (menu_id, sales_location_id),
  UNIQUE (id, organisation_id)
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  menu_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (menu_id, organisation_id) REFERENCES menus(id, organisation_id),
  FOREIGN KEY (sku_id, organisation_id) REFERENCES skus(id, organisation_id),
  UNIQUE (menu_id, sku_id),
  UNIQUE (id, organisation_id)
);

CREATE TABLE menu_item_prices (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  menu_item_id uuid NOT NULL,
  sales_location_id uuid,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (menu_item_id, organisation_id) REFERENCES menu_items(id, organisation_id),
  FOREIGN KEY (sales_location_id, organisation_id) REFERENCES sales_locations(id, organisation_id),
  UNIQUE NULLS NOT DISTINCT (menu_item_id, sales_location_id),
  UNIQUE (id, organisation_id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_organisation_idx ON events(organisation_id);
CREATE INDEX sales_locations_event_idx ON sales_locations(event_id);
CREATE INDEX inventory_locations_event_idx ON inventory_locations(event_id);
CREATE INDEX products_organisation_idx ON products(organisation_id);
CREATE INDEX skus_product_idx ON skus(product_id);
CREATE INDEX menus_event_idx ON menus(event_id);
CREATE INDEX menu_assignments_menu_idx ON menu_assignments(menu_id);
CREATE INDEX menu_items_menu_idx ON menu_items(menu_id);
CREATE INDEX menu_item_prices_item_idx ON menu_item_prices(menu_item_id);
CREATE INDEX audit_events_organisation_created_idx ON audit_events(organisation_id, created_at DESC);
