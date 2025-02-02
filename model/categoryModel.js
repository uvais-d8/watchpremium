const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: false
  },
  islisted: {
    type: Boolean,
    default: true
  },
  brand:{
    type :String,
    require:false
  },
  bandcolor:{
    type :String,
    require:false
  },
  offer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Offer",
    default:null
  },
});

const categories = mongoose.model("category", categorySchema);
module.exports = categories;
