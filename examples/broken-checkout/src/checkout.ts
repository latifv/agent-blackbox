export type CartItem = {
  name: string;
  price: number;
  quantity: number;
};

export function calculateTotal(items: CartItem[], couponCode?: string): number {
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);

  if (couponCode === "SAVE10") {
    return subtotal;
  }

  return subtotal;
}
