const crypto = require ("crypto")
const Cart = require("../model/cartModel");
const Products = require("../model/productsmodal");
const Orders = require("../model/ordersmodal");
const Razorpay = require("razorpay");
const Coupons = require("../model/couponModel");
const Address = require ("../model/addressModel")
const Offer = require("../model/offermodel");
const Wallet = require("../model/walletModel");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});
const applycoupon = async (req, res) => {
  const { couponCode, cartTotal } = req.body;
console.log("req.body",req.body)
  try {
     if (!couponCode) {
      console.log("Coupon code is required");
      return res.status(400).json({ message: "Coupon code is required" });
    }

     const coupon = await Coupons.findOne({ couponCode: couponCode });
console.log("coupon",coupon)
    if (!coupon) {
      console.log("Coupon code is invalid");
      return res.status(404).json({ message: "Coupon code is invalid" });
    }

    const currentDate = new Date();
    if (coupon.expiryDate < currentDate) {
      console.log("Coupon code has expired");

      return res.status(400).json({ message: "Coupon code has expired" });
    }

     if (coupon.UsageLimit <= 0) {
      console.log("Coupon code usage limit has been reached");
      return res
        .status(400)
        .json({ message: "Coupon code usage limit has been reached" });
    }

     if (coupon.MinimumCartValue && cartTotal < coupon.MinimumCartValue) {
      console.log(
        `Minimum cart value for this coupon is ₹${coupon.MinimumCartValue}`
      );
      return res.status(400).json({
        message: `Minimum cart value for this coupon is ₹${coupon.MinimumCartValue}`
      });
    }

     let discount = 0;
    if (coupon.DiscountType === "percentage") {
      discount = cartTotal * coupon.DiscountValue / 100;
    } else if (coupon.DiscountType === "fixed") {
      discount = coupon.DiscountValue;
    }

    discount = Math.min(discount, cartTotal);

     const newTotal = cartTotal - discount;

     if (coupon.UsageLimit > 0) {
      coupon.UsageLimit -= 1;
      await coupon.save();
    }

    res.status(200).json({
      message: "Coupon applied successfully",
      discount,
      newTotal
    });
  } catch (error) {
    console.error("Error while applying coupon:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};





const placeOrder = async (req, res) => {
  const userId = req.session.userId;
  const {
    email,
    phone,
    paymentMethod,
    items,
    pincode,
    district,
    firstname,
    place,
    orderTotal,
    city,
    lastname,
    address,
  } = req.body;

  console.log(req.body);

  const errors = {};

  // Validation
  if (!firstname) errors.firstname = "First name is required.";
  if (!lastname) errors.lastname = "Last name is required.";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Invalid email.";
  if (!phone || !/^[0-9]{10}$/.test(phone))
    errors.phone = "Invalid phone number.";
  if (!address) errors.address = "Address is required";
  if (!pincode || !/^[0-9]{6}$/.test(pincode))
    errors.pincode = "Invalid pin code";
  if (!place) errors.place = "Place is required";
  if (!city) errors.city = "City is required";
  if (!district) errors.district = "District is required";

  const allowedPaymentMethods = ["wallet", "cod", "razorpay"];
  if (!paymentMethod || !allowedPaymentMethods.includes(paymentMethod)) {
    errors.paymentMethod = "Invalid or unsupported payment method selected";
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    errors.items = "No items in the cart";
  }

  try {
    const cartItems = await Cart.find({ user: userId }).populate("productId");

    if (cartItems.length === 0) {
      throw new Error("No items in the cart.");
    }

    const updatedCartItems = cartItems.map((item) => {
      const product = item.productId;
      if (!product) throw new Error(`Product not found.`);
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}.`);
      }
      return {
        ...item.toObject(),
        price: product.price,
        total: product.price * item.quantity,
        status: "scheduled",
      };
    });

    const shippingAddress = {
      firstname,
      lastname,
      address,
      phone,
      email,
      place,
      city,
      pincode,
      district,
    };

    if (paymentMethod === "cod" && orderTotal > 1000) {
      return res.status(400).json({
        success: false,
        message: "Cash on Delivery (COD) is not available for orders above ₹1000.",
      });
    }

    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderReference = `ORD-${datePart}-${randomSuffix}`;

    let wallet = await Wallet.findOne({ user: userId });
    console.log("wallet", wallet);
    console.log("paymentMethod", paymentMethod);

    if (paymentMethod == "wallet") {
      if (orderTotal > wallet.balance) {
        console.log("Insufficient balance in wallet");
        return res.json({
          success: false,
          message: 'Insufficient balance in wallet',
        });
      } else if (!wallet) {
        return res.json({
          success: false,
          message: 'You don\'t have the wallet yet',
        });
      } else {
        wallet.balance -= orderTotal;
        wallet.transactions.push({
          type: "debit",
          amount: orderTotal,
          description: `Payment for the order ( ${orderReference} )`,
        });
      }
    }

    await wallet.save();
 
    const newOrder = new Orders({
      userId,
      items: updatedCartItems,
      orderTotal,  
      paymentMethod,
      shippingAddress,
      orderReference,
      status: "scheduled",
    });

    console.log("New order details:", newOrder);
    const savedOrder = await newOrder.save();

    console.log("Order saved successfully.");
 
    for (let item of updatedCartItems) {
      const product = await Products.findById(item.productId);
      if (product) {
        product.stock -= item.quantity;
        await product.save();
        console.log(`Product ${product.name} stock updated. New stock: ${product.stock}`);
      } else {
        console.log(`Product with ID ${item.productId} not found.`);
      }
    }
 
    await Cart.deleteMany({ user: userId });
    console.log(`Cart items for user ${userId} have been deleted.`);

    res.json({ success: true, orderId: savedOrder._id });
  } catch (error) {
    console.log("Error placing order:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to place order.",
    });
  }
};


const razorpayy = async (req, res) => {
  const userId = req.session.userId;
  console.log("Razorpay processing");

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const {
      orderTotal,
      email,
      phone,
      paymentMethod,
      items,
      pincode,
      district,
      firstname,
      place,
      city,
      lastname,
      address,
    } = req.body;

    console.log("req.body", req.body);

     const cartItems = await Cart.find({ user: userId }).populate("productId");

    if (cartItems.length === 0) {
      throw new Error("No items in the cart.");
    }

     const amount = orderTotal * 100;

     const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `order_${Date.now()}`,
    });

     const updatedCartItems = await Promise.all(
      cartItems.map(async (item) => {
        const product = item.productId;
        if (!product) throw new Error(`Product not found.`);
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}.`);
        }
         product.stock -= item.quantity;
        await product.save();
        return {
          ...item.toObject(),
          price: product.price,
          total: product.price * item.quantity,
        };
      })
    );

    const shippingAddress = {
      email,
      phone,
      paymentMethod,
      items,
      pincode,
      district,
      firstname,
      place,
      city,
      lastname,
      address,
    };

    const existingAddress = await Address.findOne({
      user: userId,
      firstname,
      lastname,
      address,
      phone,
      email,
      place,
      city,
      pincode,
      district,
    });

    if (!existingAddress) {
       await Address.updateMany({ user: userId }, { isDefault: false });

       const newAddress = new Address({
        user: userId,
        firstname,
        lastname,
        address,
        phone,
        email,
        place,
        city,
        pincode,
        district,
        isDefault: true,
      });

      await newAddress.save();
      console.log("New address saved:", newAddress);
    } else {
      console.log("Address already exists:", existingAddress);
    }

    
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase(); 
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, ''); 
    const orderReference = `ORD-${datePart}-${randomSuffix}`;

    const newOrder = new Orders({
      userId,
      orderReference,
      items: updatedCartItems,
      orderTotal,
      status: "payment-pending",
      shippingAddress,
      paymentMethod: "razorpay",
      items: updatedCartItems.map((item) => ({
        ...item,
        status: "payment-pending",
      })),
      razorpayDetails: {
        orderId: order.id,
        amount,
        currency: order.currency,
      },
    });

    console.log("Order Total before save:", newOrder.orderTotal);
    const savedOrder = await newOrder.save();
    console.log("Order Total after save:", savedOrder.orderTotal);

    for (let item of newOrder.items) {
      const productId = item.productId;
      const quantity = item.quantity;

      const product = await Products.findById(productId);

      if (product) {
        product.salesCount += quantity;
        await product.save();
        console.log(
          `Product ${product.name} salesCount updated to ${product.salesCount}`
        );
      } else {
        console.log(`Product with ID ${productId} not found.`);
      }
    }

    console.log(`Cart items for user ${userId} have been deleted.`);
    await Cart.deleteMany({ user: userId });

    res.json({
      success: true,
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      orderId: savedOrder._id,
    });
  } catch (error) {
    console.log("Error creating Razorpay order:", error);
    res.status(500).json({ success: false, message: error });
  }
};
const getProductStock = async (req, res) => {
  const { cartId } = req.params;
  try {
    const cartItem = await Cart.findById(cartId).populate("productId");
    if (!cartItem) {
      return res
        .status(404)
        .json({ success: false, message: "Cart item not found" });
    }
    const product = cartItem.productId;
    return res.status(200).json({ stock: product.stock });
  } catch (error) {
    console.error("Error fetching product stock:", error);
    res.status(500).json({ success: false, message: "Failed to fetch stock" });
  }
};
const updateQuantity = async (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { quantity } = req.body;

  if (quantity < 1 || quantity > 11) {
    return res.status(400).json({ message: "Invalid quantity" });
  }

  try {
    const cartItem = await Cart.findById(id).populate("productId");
    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    // Get the price based on product discount or original price
    let price = cartItem.productId.priceWithDiscount > 0 ? cartItem.productId.priceWithDiscount : cartItem.productId.price;

    // Recalculate the total price for the current item after updating quantity
    const total = price * quantity;

    // Update the quantity of the cart item
    await Cart.updateOne({ _id: id }, { $set: { quantity } });

    // Recalculate the subtotal for all cart items based on the updated quantities and prices
    let subtotal = 0;
    const carts = await Cart.find({ user: userId }).populate("productId");

    carts.forEach(item => {
      const itemPrice = item.productId.priceWithDiscount > 0 ? item.productId.priceWithDiscount : item.productId.price;
      subtotal += itemPrice * item.quantity;
    });

    res.json({
      success: true,
      quantity,
      total: total.toFixed(2),
      subtotal: subtotal.toFixed(2)
    });
  } catch (error) {
    console.error("Error updating cart quantity:", error);
    res.status(500).json({ success: false, message: "Error updating quantity." });
  }
};



const loadcartpage = async (req, res) => {
  try {
    const userId = req.session.userId;
    console.log("Session User ID:", userId);

    // Fetch cart items and populate the product details (including priceWithDiscount)
    const carts = await Cart.find({ user: userId }).populate("productId");
    console.log("Cart Items:", carts);

    if (!carts || carts.length === 0) {
      return res.render("cart", {
        carts: [],
        message: "There are no items in your cart at the moment"
      });
    }

    // Adding product image to the cart item
    carts.forEach(cart => {
      if (cart.productId.images && cart.productId.images.length > 0) {
        cart.firstImage = cart.productId.images[0];
      }
    });

    // Calculate the subtotal using the priceWithDiscount from the product model
    let subtotal = 0;
    carts.forEach(item => {
      const price = item.productId.priceWithDiscount > 0 ? item.productId.priceWithDiscount : item.productId.price;
      subtotal += price * item.quantity;
    });

    // Add shipping rate to the total
    const shippingRate = 50;
    const total = subtotal ;

    res.render("cart", {
      carts,
      subtotal,
      shippingRate,
      total
    });
  } catch (error) {
    console.error("Error occurred during cart page:", error);
    res.status(500).send("Internal Server Error");
  }
};

const removecart = async (req, res) => {
  const { id } = req.params;

  try {
    const cartItem = await Cart.findById(id);
    if (!cartItem) {
      console.error("Cart item not found");
      return res.redirect("/cart");
    }

    await Cart.findByIdAndDelete(id);

    console.log("Item deleted and stock updated successfully");
    res.redirect("/cart");
  } catch (error) {
    console.error("Error deleting item or updating stock:", error);
    res.redirect("/cart");
  }
};
const addtocart = async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const { quantity, productId } = req.body;

    const productQuantity = parseInt(quantity) || 1;

    if (!productId) {
      return res.status(400).json({ error: "Product ID is required" });
    }

    const product = await Products.findById(productId).populate("offer");

    if (!product) {
      return res.render("singleproduct", { message: "Product not found" });
    }

    if (!product.islisted) {
      return res.render("singleproduct", {
        message: "This product is currently unavailable",
        product
      });
    }

    // Check if there's enough stock for the requested quantity
    if (product.stock < productQuantity) {
      return res.render("singleproduct", {
        message: "Not enough stock available for this quantity",
        product
      });
    }

    let discountedPrice = product.price;

    // Apply discount if offer exists and is valid
    if (
      product.offer &&
      product.offer.Status &&
      product.offer.ExpiryDate > Date.now()
    ) {
      if (product.offer.DiscountType === "percentage") {
        const discount = (product.price * product.offer.DiscountValue) / 100;
        discountedPrice = Math.max(0, product.price - discount); // Prevent negative price
      } else if (product.offer.DiscountType === "fixed") {
        discountedPrice = Math.max(0, product.price - product.offer.DiscountValue);
      }
    }

    // Check if product is already in the cart
    const existingItem = await Cart.findOne({ user: userId, productId });

    if (existingItem) {
      const newQuantity = existingItem.quantity + productQuantity;

      if (newQuantity > product.stock) {
        return res.render("singleproduct", {
          message: "Cannot add more than the available stock to your cart",
          product
        });
      }

      if (newQuantity > 10) {
        return res.render("singleproduct", {
          message: "Cannot add more than 10 units of this item to your cart",
          product
        });
      }

      existingItem.quantity = newQuantity;
      existingItem.productId.priceWithDiscount = discountedPrice;
      existingItem.totalPrice = newQuantity * discountedPrice;  // Calculate the new total price
      await existingItem.save();
    } else {
      const cartItem = new Cart({
        user: userId,
        productId,
        quantity: productQuantity,
        priceWithDiscount: discountedPrice,
        totalPrice: productQuantity * discountedPrice  // Calculate the total price on adding to cart
      });
      await cartItem.save();
    }

    res.redirect("/cart");
  } catch (error) {
    console.error("Error adding product to cart:", error);
    res.status(500).json({ error: "Failed to add product to cart" });
  }
};

const paymentSuccess = async (req, res) => {
  const orderId = req.params.id;
  console.log("Order ID:", orderId);

  try {
     const result = await Orders.updateOne(
      { _id: orderId },  
      {
        $set: {
          status: "scheduled", 
          "items.$[].status": "scheduled" 
        }
      }
    );

    console.log("Update Result:", result);

     if (result.matchedCount === 0) {
      console.error("No matching order found");
      return res.status(404).send("Order not found");
    }

    console.log("Order and items' statuses updated to scheduled.");
    return res.json({ success: true });
  } catch (error) {
    console.error("Error in paymentSuccess controller:", error);
    return res.status(500).send("Internal Server Error");
  }
};
const retryRazorpay = async (req, res) => {
  console.log("Retry payment processing 2");

   const orderId = req.params.id;
  console.log("orderId:", orderId);

  const userId = req.session.userId;
  console.log("userId:", userId);

  if (!userId) return res.redirect("/login");

  try {
    const order = await Orders.findOne({ _id: orderId, userId });

    if (!order) {
      console.log('not order',order)
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (order.status !== "payment-pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot retry payment for an order with status: ${order.status}.`,
      });
    }

     if (order.razorpayDetails?.orderId) {
      return res.json({
        success: true,
        razorpayOrder: order.razorpayDetails,  
        orderId: order._id,  
        items: order.items, 
        shippingAddress: order.shippingAddress, 
      });
    }

     const amount = order.orderTotal * 100; 
    const razorpayOrder = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `retry_${orderId}_${Date.now()}`,
    });

     order.razorpayDetails = {
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    };
    await order.save();

     res.json({
      success: true,
      razorpayOrder, 
      orderId: order._id, 
      items: order.items, 
      shippingAddress: order.shippingAddress, 
    });
  } catch (error) {
    console.error("Error processing retry payment:", error);
    res.status(500).json({ success: false, message: "Failed to retry payment." });
  }
};
const retrypaymentSuccess = async (req, res) => {
  console.log("Controller success");

  const orderId = req.params.id; 
  console.log("Order ID received:", orderId);

  try {
     const updatedOrder = await Orders.findOneAndUpdate(
      { _id: orderId },  
      {
        $set: {
          status: "scheduled",
          "items.$[].status": "scheduled",  
        },
      },
      { new: true }  
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json({
      message: "Order and all item statuses updated to scheduled",
      updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order and item statuses:", error);
    res.status(500).json({
      message: "Server error, unable to update order and item statuses",
    });
  }
};
const removecoupon = async (req, res) => {
  try {

    console.log("remove coupon processing")
     console.log("Raw coupon code from params:", req.params.couponCode);
    
     const couponCode = String(req.params.couponCode);    
    console.log("Coupon code to remove (converted to string):", couponCode);
    
     const coupon = await Coupons.findOne({ couponCode: couponCode });
     console.log("old usage limit",coupon.UsageLimit)

    if (!coupon) { 
        console.log("Coupon found:", coupon);
       return res.status(400).json({ message: 'Coupon not found' });
    
    }

  const cartTotal = req.body.cartTotal || 0; 
    res.status(200).json({
      originalTotal: cartTotal,  
            message: 'Coupon removed successfully',
    });
  // Increment the usage limit
    coupon.UsageLimit += 1;
    await coupon.save();
    console.log("new usage limit",coupon.UsageLimit)
     
  } catch (error) {
    console.error('Error removing coupon:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


module.exports = {
  retryRazorpay,
  retrypaymentSuccess,
   addtocart,
  paymentSuccess,
   loadcartpage,
  removecart,
  placeOrder,
  updateQuantity,
  getProductStock,
  razorpayy,
  applycoupon,
  removecoupon
};
