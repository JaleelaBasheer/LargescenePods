import './App.css';
import FbxtoGlb from './Components/FbxtoGlb';
import FbxToGlbFinalLargeScene from './Components/FbxToGlbFinalLargeScene';
import FbxToGlbLargeScene from './Components/FbxToGlbLargeScene';
import IndexedDbRandomFbx from './Components/IndexedDbRandomFbx';
import RandomBoxesScene from './Components/RandomBoxes';
import RandomFBXFiles from './Components/RandomFBXFiles';

function App() {
  return (
    <div >
      {/* <RandomBoxesScene/> */}
      {/* <RandomFBXFiles/> */}
      {/* <IndexedDbRandomFbx/> */}
      {/* <FbxtoGlb/> */}
      <FbxToGlbLargeScene/>
      {/* <FbxToGlbFinalLargeScene/> */}
     
    </div>
  );
}

export default App;
