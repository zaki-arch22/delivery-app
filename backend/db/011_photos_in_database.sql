-- Driver document photos are kept IN the database (private, never in a web folder, backed up with everything else)
-- instead of a disk folder: free hosts have no permanent disk, and one place to protect and back up is simpler.
-- Each photo is a redrawn JPEG of at most 2000 px (usually well under 1 MB).
CREATE TABLE document_files (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  data        bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 6291456)
);
