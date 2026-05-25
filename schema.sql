-- 知识条目表
CREATE TABLE items (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT '未分类',
  summary TEXT DEFAULT '',
  tags JSONB DEFAULT '[]',
  image TEXT,
  related_ids JSONB DEFAULT '[]',
  fingerprint JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 星系名称表
CREATE TABLE galaxies (
  category TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ai_generated BOOLEAN DEFAULT false
);

-- 允许匿名访问（Row Level Security）
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE galaxies ENABLE ROW LEVEL SECURITY;

-- 公开读写策略（因为是个人知识库，不需要复杂权限）
CREATE POLICY "public_all" ON items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON galaxies FOR ALL USING (true) WITH CHECK (true);
