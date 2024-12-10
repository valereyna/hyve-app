import ImageKit from "imagekit";
import Post from "../models/post.model.js";
import User from "../models/user.model.js";

export const getPosts = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 2;

  const query = {};

  console.log(req.query);

  const cat = req.query.cat;
  const author = req.query.author;
  const searchQuery = req.query.search;
  const sortQuery = req.query.sort;
  const featured = req.query.featured;

  if (cat) {
    query.category = cat;
  }

  if (searchQuery) {
    query.title = { $regex: searchQuery, $options: "i" };
  }

  if (author) {
    const user = await User.findOne({ username: author }).select("_id");

    if (!user) {
      return res.status(404).json("No post found!");
    }

    query.user = user._id;
  }

  let sortObj = { createdAt: -1 };

  if (sortQuery) {
    switch (sortQuery) {
      case "newest":
        sortObj = { createdAt: -1 };
        break;
      case "oldest":
        sortObj = { createdAt: 1 };
        break;
      case "popular":
        sortObj = { visit: -1 };
        break;
      case "trending":
        sortObj = { visit: -1 };
        query.createdAt = {
          $gte: new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000),
        };
        break;
      default:
        break;
    }
  }

  if (featured) {
    query.isFeatured = true;
  }

  const posts = await Post.find(query)
    .populate("user", "username")
    .sort(sortObj)
    .limit(limit)
    .skip((page - 1) * limit);

  const totalPosts = await Post.countDocuments();
  const hasMore = page * limit < totalPosts;

  res.status(200).json({ posts, hasMore });
};

export const getPost = async (req, res) => {
  const post = await Post.findOne({ slug: req.params.slug }).populate(
    "user",
    "username img"
  );
  res.status(200).json(post);
};

export const createPost = async (req, res) => {
  const clerkUserId = req.auth.userId;

  console.log(req.headers);

  if (!clerkUserId) {
    return res.status(401).json("Not authenticated!");
  }

  const user = await User.findOne({ clerkUserId });

  if (!user) {
    return res.status(404).json("User not found!");
  }

  let slug = req.body.title.replace(/ /g, "-").toLowerCase();

  let existingPost = await Post.findOne({ slug });

  let counter = 2;

  while (existingPost) {
    slug = `${slug}-${counter}`;
    existingPost = await Post.findOne({ slug });
    counter++;
  }

  const newPost = new Post({ user: user._id, slug, ...req.body });

  const post = await newPost.save();
  res.status(200).json(post);
};

export const deletePost = async (req, res) => {
  const clerkUserId = req.auth.userId;

  if (!clerkUserId) {
    return res.status(401).json("Not authenticated!");
  }

  const role = req.auth.sessionClaims?.metadata?.role || "user";

  if (role === "admin") {
    await Post.findByIdAndDelete(req.params.id);
    return res.status(200).json("Post has been deleted");
  }

  const user = await User.findOne({ clerkUserId });

  const deletedPost = await Post.findOneAndDelete({
    _id: req.params.id,
    user: user._id,
  });

  if (!deletedPost) {
    return res.status(403).json("You can delete only your posts!");
  }

  res.status(200).json("Post has been deleted");
};

export const featurePost = async (req, res) => {
  const clerkUserId = req.auth.userId;
  const postId = req.body.postId;

  if (!clerkUserId) {
    return res.status(401).json("Not authenticated!");
  }

  const role = req.auth.sessionClaims?.metadata?.role || "user";

  if (role !== "admin") {
    return res.status(403).json("You cannot feature posts!");
  }

  const post = await Post.findById(postId);

  if (!post) {
    return res.status(404).json("Post not found!");
  }

  const isFeatured = post.isFeatured;

  const updatedPost = await Post.findByIdAndUpdate(
    postId,
    {
      isFeatured: !isFeatured,
    },
    { new: true }
  );

  res.status(200).json(updatedPost);
};

const imagekit = new ImageKit({
  urlEndpoint: "https://ik.imagekit.io/axel",
  publicKey: "public_4yGr8RyYi5Ah0vqu2kpdOIRz6E8=",
  privateKey: "private_UHKqFgn171jDu0iij1tsH0Ha+ec=",
});

export const uploadAuth = async (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.send(result);
};

export const approvePost = async (req, res) => {
  const clerkUserId = req.auth.userId;
  const { postId } = req.body;

  if (!clerkUserId) return res.status(401).json("Not authenticated!");

  const role = req.auth.sessionClaims?.metadata?.role || "user";
  if (role !== "admin") return res.status(403).json("You cannot approve posts!");

  const post = await Post.findById(postId);
  if (!post) return res.status(404).json("Post not found!");

  if (post.approved) {
    return res.status(400).json("Post already approved!");
  }

  post.approved = true;
  await post.save();

  res.status(200).json(post);
};

export const awardNectar = async (req, res) => {
  const clerkUserId = req.auth.userId;
  const { postId } = req.body;

  if (!clerkUserId) return res.status(401).json("Not authenticated!");

  const role = req.auth.sessionClaims?.metadata?.role || "user";
  if (role !== "admin") return res.status(403).json("Admin privileges required!");

  const post = await Post.findById(postId).populate('user');
  if (!post) return res.status(404).json("Post not found!");
  
  if (!post.approved) {
    return res.status(400).json("Post must be approved before awarding nectar!");
  }

  if (post.nectarAwarded) {
    return res.status(400).json("Nectar already awarded for this post!");
  }

  const user = await User.findById(post.user._id);
  if (!user) return res.status(404).json("User not found!");
  
  // Optional: Implement time gating logic here if needed
  const now = new Date();
  if (user.lastNectarAwardAt && now - user.lastNectarAwardAt < 86400000) {
    const waitHours = Math.ceil((86400000 - (now - user.lastNectarAwardAt)) / 3600000);
    return res.status(400).json(`User must wait ${waitHours} more hour(s) before receiving Nectar again.`);
  }

  user.nectar += 5;
  user.lastNectarAwardAt = new Date();
  await user.save();

  post.nectarAwarded = true;
  await post.save();

  res.status(200).json({ message: "Nectar awarded successfully!", nectar: user.nectar });
};