/**
 * Order columns readable by signed-in users (staff and the customer who owns
 * the order). admin_note is deliberately absent: customers must not read the
 * staff note; staff read it through the admin_order_note() function.
 * Keep in sync with the column grant in migration 0013.
 */
export const ORDER_COLUMNS =
  "id, order_number, customer_id, user_id, customer_name, phone, email, address, city, area, delivery_zone, note, subtotal, discount, delivery_charge, total, coupon_id, coupon_code, payment_method, payment_status, status, is_demo, created_at, updated_at";
