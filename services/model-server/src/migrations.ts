export interface Migration {
  version: number;
  up: string;
  down: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email varchar(320) NOT NULL UNIQUE,
        display_name varchar(120) NOT NULL,
        password_hash text NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        token_hash varchar(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        replaced_by uuid,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
      CREATE INDEX auth_sessions_family_idx ON auth_sessions(family_id);
      CREATE TABLE diagrams (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id),
        name varchar(160) NOT NULL,
        model jsonb NOT NULL,
        model_version varchar(40) NOT NULL,
        model_sha256 varchar(64) NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE diagram_members (
        diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role varchar(10) NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (diagram_id, user_id)
      );
      CREATE UNIQUE INDEX diagram_single_owner_idx ON diagram_members(diagram_id) WHERE role = 'owner';
      CREATE TABLE diagram_invitations (
        id uuid PRIMARY KEY,
        diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
        email varchar(320) NOT NULL,
        role varchar(10) NOT NULL CHECK (role IN ('editor', 'viewer')),
        token_hash varchar(64) NOT NULL UNIQUE,
        status varchar(10) NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
        invited_by uuid NOT NULL REFERENCES users(id),
        accepted_by uuid REFERENCES users(id),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX diagram_invitations_lookup_idx ON diagram_invitations(diagram_id, email, status);
      CREATE TABLE diagram_share_links (
        id uuid PRIMARY KEY,
        diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
        role varchar(10) NOT NULL CHECK (role IN ('editor', 'viewer')),
        token_hash varchar(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
        use_count integer NOT NULL DEFAULT 0,
        revoked_at timestamptz,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL
      );
      CREATE TABLE diagram_share_redemptions (
        share_link_id uuid NOT NULL REFERENCES diagram_share_links(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (share_link_id, user_id)
      );
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY,
        actor_user_id uuid REFERENCES users(id),
        action varchar(80) NOT NULL,
        resource_type varchar(40) NOT NULL,
        resource_id uuid,
        result varchar(20) NOT NULL,
        request_id uuid NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE collaboration_snapshots (
        diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
        base_seq_number bigint NOT NULL,
        model_version varchar(40) NOT NULL,
        model_sha256 varchar(64) NOT NULL,
        model jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (diagram_id, base_seq_number)
      );
      CREATE TABLE collaboration_oplog (
        diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
        seq_number bigint NOT NULL,
        client_id uuid NOT NULL,
        client_command_id uuid NOT NULL,
        command_payload jsonb NOT NULL,
        resulting_version varchar(40) NOT NULL,
        resulting_sha256 varchar(64) NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (diagram_id, seq_number)
      );
      CREATE TABLE collaboration_dedup (
        diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
        client_id uuid NOT NULL,
        client_command_id uuid NOT NULL,
        command_hash varchar(64) NOT NULL,
        seq_number bigint NOT NULL,
        resulting_version varchar(40) NOT NULL,
        resulting_sha256 varchar(64) NOT NULL,
        command_payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (diagram_id, client_id, client_command_id)
      );
    `,
    down: `
      DROP TABLE collaboration_dedup;
      DROP TABLE collaboration_oplog;
      DROP TABLE collaboration_snapshots;
      DROP TABLE audit_events;
      DROP TABLE diagram_share_redemptions;
      DROP TABLE diagram_share_links;
      DROP TABLE diagram_invitations;
      DROP TABLE diagram_members;
      DROP TABLE diagrams;
      DROP TABLE auth_sessions;
      DROP TABLE users;
    `,
  },
];
