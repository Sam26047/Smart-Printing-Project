import jwt from "jsonwebtoken";

export const generateToken = (user)=>{  //use secret key to create access token
    return jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn:"1d" }
    );
};

export const authenticate = (req,res,next)=>{
    const auth = req.headers.authorization;   //get authorization header from request object

    if(!auth || !auth.startsWith("Bearer ")){   //check existence and format
        return res.status(401).json({error: "Missing token"});
    }

    try{
        const token = auth.split(" ")[1];  //separate keyword "Bearer" and the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);  //check signature and return payload
        req.user = decoded;
        next();
    }catch{
        res.status(401).json({ error: " Invalid token" });
    }
};

export const requireAdmin = (req,res,next)=>{
    if(req.user.role !== "ADMIN"){
        return res.status(403).json({ error: "Admin access required" }); //check if user is an admin for access to a particular endpoint
    }
    next();
}