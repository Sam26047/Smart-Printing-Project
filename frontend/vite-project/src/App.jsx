import UploadForm from "./components/UploadForm";
import AdminQueue from "./components/AdminQueue";

function App(){
  return (
    <div>
      <h1>Smart Printing System</h1>
      <UploadForm /> 
      <hr />
      <AdminQueue />
    </div>
  );
}

export default App
