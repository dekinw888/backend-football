# backend-football — Deployment guide (Supabase + Render)

สรุปแผนงานที่เตรียมให้:
- เพิ่ม .gitignore, Dockerfile และ .dockerignore
- อัปเดตการเชื่อมต่อ PostgreSQL ให้รองรับ DATABASE_URL (Supabase) และ SSL
- ตัว repo พร้อมให้สร้าง GitHub repo และเชื่อมต่อกับ Render เพื่อ deploy อัตโนมัติ

ขั้นตอนสั้นๆ (ละเอียดด้านล่าง):
1. สร้าง GitHub repository ใหม่ (private หรือ public)
2. ลบหรือย้ายไฟล์ .env (อย่า commit) แล้ว push โค้ดขึ้น GitHub
3. สร้าง Supabase project (free) เพื่อได้ PostgreSQL database
4. สร้าง Render Web Service (Free) และเชื่อมต่อกับ GitHub repo เพื่อ deploy
5. ตั้งค่า Environment variables ใน Render (DATABASE_URL หรือ DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME และ JWT_SECRET)

สำคัญ: ไฟล์ .env ถูกเพิ่มไว้ใน repo ของคุณเท่านั้น — อย่า commit ค่าความลับ (DB password, JWT secret) ขึ้น GitHub

การตั้งค่า Supabase
1. เข้า https://supabase.com และสร้าง project ใหม่
2. ในหน้า Settings -> Database -> Connection string จะพบ `DATABASE_URL` (รูปแบบ: postgres://user:pass@host:port/dbname)
3. ถ้ามีข้อมูลใน .env ให้ย้ายค่า DB_* ไปเก็บเป็น Environment variables ใน Render หรือใช้ DATABASE_URL เดียว

การตั้งค่า Render
1. เข้า https://render.com และสมัคร/ล็อกอิน
2. Create -> Web Service -> Connect a repository -> เลือก repo ที่เพิ่งสร้าง
3. Build command: `npm ci`
   Start command: `npm start`
   Environment: `Node 18`
   Port: leave default (Render จะตั้งค่า PORT env var). โค้ดมี fallback เป็น 5000
4. ใน Render dashboard ของ service ให้ไปที่ Environment -> Add Environment Variable และเพิ่มค่าตามนี้ (หากใช้ DATABASE_URL ให้เพิ่มแค่ DATABASE_URL และ JWT_SECRET)
   - DATABASE_URL (จาก Supabase)  หรือ
   - DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME (ถ้าแยกค่า)
   - JWT_SECRET (กำหนดค่ายากๆ และเก็บเป็นความลับ)
   - PORT (ไม่จำเป็น, Render ใส่ให้)

การ migrate / เตรียม schema
- ถ้าต้องการสร้างตาราง ให้ใช้ Supabase SQL Editor (หรือเชื่อมด้วย psql) รัน SQL ที่โปรเจกต์ต้องการ

การเชื่อมต่อ SSL
- โค้ดใน repo ได้อัปเดตให้รองรับ DATABASE_URL จาก Supabase และตั้งค่า ssl: { rejectUnauthorized: false } ให้เชื่อมต่อได้จาก Render

ไฟล์สำคัญใน repo
- [src/server.js](C:/Users/watta/backend-football/src/server.js)
- [src/config/db.js](C:/Users/watta/backend-football/src/config/db.js) (อัปเดตให้รองรับ Supabase)
- Dockerfile

ถ้าต้องการ ผมสามารถ:
- สร้าง GitHub repo ให้และ push โค้ด (ต้องการสิทธิ/เชื่อมต่อกับบัญชีของคุณ)
- ช่วยตั้งค่า Supabase project ถ้าคุณให้สิทธิ (หรือผมจะให้คำสั่งทีละขั้นตอน)
- ช่วยตั้งค่า Render (ต้องการ API key) 

บอกได้เลยว่าต้องการให้ช่วยก้าวต่อไปแบบไหน: สร้าง GitHub repo และ push ให้ (แนะนำ), หรือผมให้คำสั่งทีละขั้นตอนให้คุณทำเอง?  
