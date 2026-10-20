\set ON_ERROR_STOP off
INSERT INTO pricing_rules(base_da,per_km_da,min_percent,max_percent,active) VALUES (100,10,80,150,true);
INSERT INTO accounts(phone) VALUES ('+213550000001'),('+213550000002');
-- account 1 has BOTH profiles, account 2 has a driver profile
INSERT INTO profiles(account_id,type,display_name,status) SELECT id,'user','Sam User','active' FROM accounts WHERE phone='+213550000001';
INSERT INTO profiles(account_id,type,display_name,status) SELECT id,'driver','Sam Driver','active' FROM accounts WHERE phone='+213550000001';
INSERT INTO profiles(account_id,type,display_name,status) SELECT id,'driver','Other Driver','active' FROM accounts WHERE phone='+213550000002';
CREATE TEMP VIEW p AS SELECT pr.id, pr.type, a.phone, pr.display_name FROM profiles pr JOIN accounts a ON a.id=pr.account_id;
CREATE OR REPLACE FUNCTION pid(ph text, t profile_type) RETURNS uuid AS $$ SELECT id FROM p WHERE phone=ph AND type=t $$ LANGUAGE sql;
INSERT INTO orders(user_profile_id,pickup_point,pickup_address,dropoff_point,dropoff_address,recipient_name,recipient_phone,size,vehicle,payer,pricing_version,distance_m,duration_s,recommended_da,min_da,max_da,offered_da,delivery_code,idempotency_key)
VALUES (pid('+213550000001','user'),'POINT(3.05 36.75)','{}','POINT(3.07 36.76)','{}','R','+213550000009','small','motorbike','sender',1,3000,600,200,160,300,200,'4821','k1');
\echo '--- TEST 1: same account driver takes own order (must FAIL)'
UPDATE orders SET driver_profile_id = pid('+213550000001','driver'), locked_da=200 WHERE idempotency_key='k1';
\echo '--- TEST 2: different account driver takes it (must SUCCEED)'
UPDATE orders SET driver_profile_id = pid('+213550000002','driver'), locked_da=200, status='assigned' WHERE idempotency_key='k1';
\echo '--- TEST 3: change locked price (must FAIL)'
UPDATE orders SET locked_da=999 WHERE idempotency_key='k1';
\echo '--- TEST 4: duplicate order same idempotency key (must FAIL)'
INSERT INTO orders(user_profile_id,pickup_point,pickup_address,dropoff_point,dropoff_address,recipient_name,recipient_phone,size,vehicle,payer,pricing_version,distance_m,duration_s,recommended_da,min_da,max_da,offered_da,delivery_code,idempotency_key)
VALUES (pid('+213550000001','user'),'POINT(3.05 36.75)','{}','POINT(3.07 36.76)','{}','R','+213550000009','small','motorbike','sender',1,3000,600,200,160,300,200,'1111','k1');
\echo '--- TEST 5: offer price outside allowed range (must FAIL)'
INSERT INTO orders(user_profile_id,pickup_point,pickup_address,dropoff_point,dropoff_address,recipient_name,recipient_phone,size,vehicle,payer,pricing_version,distance_m,duration_s,recommended_da,min_da,max_da,offered_da,delivery_code,idempotency_key)
VALUES (pid('+213550000001','user'),'POINT(3.05 36.75)','{}','POINT(3.07 36.76)','{}','R','+213550000009','small','motorbike','sender',1,3000,600,200,160,300,50,'2222','k2');
\echo '--- TEST 6: rate before delivery (must FAIL)'
INSERT INTO ratings(order_id,rater_profile_id,rated_profile_id,stars) SELECT id,user_profile_id,driver_profile_id,5 FROM orders WHERE idempotency_key='k1';
UPDATE orders SET status='delivered', delivered_at=now() WHERE idempotency_key='k1';
\echo '--- TEST 7: rate after delivery (must SUCCEED), then rating total updates'
INSERT INTO ratings(order_id,rater_profile_id,rated_profile_id,stars,comment) SELECT id,user_profile_id,driver_profile_id,4,'fast' FROM orders WHERE idempotency_key='k1';
SELECT display_name, rating_sum, rating_count FROM profiles WHERE rating_count>0;
\echo '--- TEST 8: rate twice (must FAIL)'
INSERT INTO ratings(order_id,rater_profile_id,rated_profile_id,stars) SELECT id,user_profile_id,driver_profile_id,1 FROM orders WHERE idempotency_key='k1';
\echo '--- TEST 9: cash collected, then try to edit it (must FAIL)'
INSERT INTO cash_ledger(driver_profile_id,order_id,type,amount_da) SELECT driver_profile_id,id,'cod_collected',5000 FROM orders WHERE idempotency_key='k1';
UPDATE cash_ledger SET amount_da=1 WHERE type='cod_collected';
DELETE FROM cash_ledger;
\echo '--- TEST 10: collect cash twice for same order (must FAIL)'
INSERT INTO cash_ledger(driver_profile_id,order_id,type,amount_da) SELECT driver_profile_id,id,'cod_collected',5000 FROM orders WHERE idempotency_key='k1';
\echo '--- TEST 11: handover without staff (must FAIL)'
INSERT INTO cash_ledger(driver_profile_id,type,amount_da) SELECT driver_profile_id,'handover',-5000 FROM orders WHERE idempotency_key='k1';
INSERT INTO documents(account_id,kind,size_bytes,sha256,profile_id) SELECT a.id,'id_photo',100,'x',pid('+213550000002','driver') FROM accounts a WHERE phone='+213550000002';
\echo '--- TEST 12: delete a driver document photo used for approval (must FAIL)'
DELETE FROM documents;
\echo '--- TEST 13: move a used document photo to another profile (must FAIL)'
UPDATE documents SET profile_id = pid('+213550000001','driver');
\echo '--- TEST 14: lock a price outside the allowed range (must FAIL)'
INSERT INTO orders(user_profile_id,pickup_point,pickup_address,dropoff_point,dropoff_address,recipient_name,recipient_phone,size,vehicle,payer,pricing_version,distance_m,duration_s,recommended_da,min_da,max_da,offered_da,delivery_code,idempotency_key,driver_profile_id,locked_da,status)
VALUES (pid('+213550000001','user'),'POINT(3.05 36.75)','{}','POINT(3.07 36.76)','{}','R','+213550000009','small','motorbike','sender',1,3000,600,200,160,300,200,'2222','k2',pid('+213550000002','driver'),999,'assigned');
\echo '--- TEST 15: a courier waiting for two customers at once (second offer must FAIL)'
INSERT INTO orders(user_profile_id,pickup_point,pickup_address,dropoff_point,dropoff_address,recipient_name,recipient_phone,size,vehicle,payer,pricing_version,distance_m,duration_s,recommended_da,min_da,max_da,offered_da,delivery_code,idempotency_key)
VALUES (pid('+213550000001','user'),'POINT(3.05 36.75)','{}','POINT(3.07 36.76)','{}','R','+213550000009','small','motorbike','sender',1,3000,600,200,160,300,200,'3333','k3'),
       (pid('+213550000001','user'),'POINT(3.05 36.75)','{}','POINT(3.07 36.76)','{}','R','+213550000009','small','motorbike','sender',1,3000,600,200,160,300,200,'4444','k4');
INSERT INTO offers(order_id,driver_profile_id,status,rank,expires_at,bid_da,bid_expires_at) SELECT id,pid('+213550000002','driver'),'bid',1,now()+interval '1 minute',200,now()+interval '1 minute' FROM orders WHERE idempotency_key='k3';
INSERT INTO offers(order_id,driver_profile_id,status,rank,expires_at,bid_da,bid_expires_at) SELECT id,pid('+213550000002','driver'),'bid',1,now()+interval '1 minute',210,now()+interval '1 minute' FROM orders WHERE idempotency_key='k4';
\echo '--- Balance of the other driver (must be 5000)'
SELECT driver_profile_id=pid('+213550000002','driver') AS is_other_driver, SUM(amount_da) FROM cash_ledger GROUP BY 1;
